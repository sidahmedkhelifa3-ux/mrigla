/* ============================================================
   selftest.js — run with:  node selftest.js
   ------------------------------------------------------------
   Loads decoder.js, store.js and scanner.js into a stubbed DOM
   and drives the paths that a browser would, so a ReferenceError
   in a callback shows up here instead of on a phone.

   `node --check` only finds syntax errors. This catches the
   "removed the variable, kept the use" class of bug — which is
   exactly what left the photo scan stuck at "Reading the photo…".
   ============================================================ */

const fs = require("fs");
const vm = require("vm");
const path = require("path");

let failures = 0;
function ok(name){ console.log("  PASS  " + name); }
function bad(name, err){
  failures++;
  console.log("  FAIL  " + name);
  console.log("        " + (err && err.stack ? err.stack.split("\n").slice(0,3).join("\n        ") : err));
}

/* ---------- minimal DOM ---------- */
function makeEl(id){
  const listeners = {};
  let _text = "", _html = "", _value = "";
  const el = {
    id, tagName: "DIV",
    hidden: false, disabled: false,
    // a real DOM stringifies these; the stub must too, or a test
    // comparing against "3" passes a number and fails confusingly
    get textContent(){ return _text; },
    set textContent(v){ _text = String(v); },
    get innerHTML(){ return _html; },
    set innerHTML(v){ _html = String(v); },
    get value(){ return _value; },
    set value(v){ _value = String(v); },
    files: [], onclick: null, style: {},
    classList: {
      _s: new Set(),
      add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      contains(c){ return this._s.has(c); }
    },
    attrs: {},
    setAttribute(k, v){ this.attrs[k] = String(v); },
    getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(){},
    dispatch(type, ev){ (listeners[type] || []).forEach(fn => fn(ev || { target: el })); },
    focus(){}, select(){}, scrollIntoView(){}, appendChild(){}, remove(){},
    closest(){ return null; },
    get offsetWidth(){ return 100; },
    getContext(){ return ctx2d; },
    play(){ return Promise.resolve(); }
  };
  return el;
}

const ctx2d = {
  save(){}, restore(){}, translate(){}, rotate(){}, drawImage(){},
  getImageData(x, y, w, h){ return { data: new Uint8ClampedArray(w * h * 4) }; }
};

const els = new Map();
const document = {
  getElementById(id){
    if(!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  },
  createElement(tag){ const e = makeEl("created-" + tag); e.tagName = tag.toUpperCase(); return e; },
  addEventListener(){}, querySelector(){ return null; }
};

const storage = new Map();
const sandbox = {
  console,
  document,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Map, Set, Math, JSON, Date, RegExp, Error, TypeError,
  Object, Array, String, Number, Boolean, Uint8ClampedArray, isNaN, isFinite,
  performance: { now: () => Date.now() },
  requestAnimationFrame(fn){ return setTimeout(fn, 16); },
  cancelAnimationFrame(h){ clearTimeout(h); },
  navigator: { vibrate(){}, mediaDevices: undefined, clipboard: undefined },
  localStorage: {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  },
  FileReader: class {
    readAsDataURL(){ setTimeout(() => this.onload && this.onload(), 0); }
    get result(){ return "data:image/png;base64,AAAA"; }
  },
  Image: class {
    constructor(){ this.naturalWidth = 640; this.naturalHeight = 480; }
    set src(v){ this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
    get src(){ return this._src; }
  },
  AudioContext: undefined,
  BarcodeDetector: undefined,   // force the ZXing path
  ZXing: undefined,             // and no ZXing either -> must fail gracefully
  addEventListener(){}, removeEventListener(){}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* Both pages share the same fake window; only the page script differs.
   Which page is under test is chosen by PAGE below. */
const ARG = process.argv[2] || "scanner";
const PAGE = ["database", "decoder", "ocr"].includes(ARG) ? ARG : "scanner";

/* A ZXing stand-in that reports a hit on the Nth decode attempt, so the
   sweep through the scan plan can be observed. */
let zxCalls = 0, zxHitOn = 0, zxSizes = [];
function installFakeZXing(){
  function Reader(){}
  Reader.prototype.setHints = function(){};
  Reader.prototype.decodeWithState = function(){
    zxCalls++;
    const c = sandbox.__lastCanvas;
    if(c) zxSizes.push(c.width + "x" + c.height);
    if(zxHitOn && zxCalls === zxHitOn){
      return {
        getText: () => "4458534760123",
        getBarcodeFormat: () => 1
      };
    }
    throw new Error("NotFoundException");
  };
  sandbox.ZXing = {
    BarcodeFormat: { EAN_13:1, EAN_8:2, UPC_A:3, UPC_E:4,
                     CODE_128:5, CODE_39:6, ITF:7, CODABAR:8 },
    DecodeHintType: { POSSIBLE_FORMATS:1, TRY_HARDER:2 },
    HTMLCanvasElementLuminanceSource: function(c){ sandbox.__lastCanvas = c; },
    BinaryBitmap: function(){},
    HybridBinarizer: function(){},
    MultiFormatReader: Reader,
    BrowserMultiFormatReader: function(){}
  };
}

sandbox.jspdf = undefined;   // exercise the "library did not load" branch
sandbox.print = function(){ sandbox.__printed = true; };

/* The database page has no camera, so seed the store the way the
   scanner would have, before its script reads localStorage. */
if(process.argv[2] === "database" && process.argv[3] === "seeded"){
  storage.set("pyjamadz.catalog.v1", JSON.stringify({
    "4458534760123": { name: "Robe", nameAr: "روب", sku: "BASKAT Z8-1", price: 1600 }
  }));
  storage.set("pyjamadz.scanlog.v1", JSON.stringify([
    { id: "a", code: "4458534760123", at: "2026-09-25T10:02:00.000Z" },
    { id: "b", code: "4458534760123", at: "2026-09-25T10:01:00.000Z" },
    { id: "c", code: "9999999999994", at: "2026-09-25T10:00:00.000Z" }
  ]));
  sandbox.__seeded = true;
}

/* ---------- load the app ---------- */
if(PAGE === "decoder") installFakeZXing();

const FILES = PAGE === "database" ? ["common.js", "store.js", "database.js"]
            : PAGE === "decoder"  ? ["decoder.js"]
            : PAGE === "ocr"      ? ["ocr.js"]
            : ["common.js", "decoder.js", "ocr.js", "store.js", "scanner.js"];

for(const f of FILES){
  try{
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), sandbox, { filename: f });
    ok("loads " + f);
  }catch(e){
    bad("loads " + f, e);
  }
}

const status = () => document.getElementById("status").innerHTML;

/* ---------- tests ---------- */
const tests = [];

if(PAGE === "ocr"){

  const parse = (t, code) => sandbox.TagOCR.parse(t, code);

  /* Text as Tesseract would plausibly return it for the PULL tag —
     the barcode digits, the reference, the price, and the brand block
     underneath that must NOT be mistaken for the product name. */
  tests.push(function readsThePullTag(done){
    const r = parse(
      "1044797380876\n" +
      "PULL AR-195\n" +
      "1950 DA\n" +
      "PYJAMA DZ\n" +
      "FASHION\n", "1044797380876");
    if(r.price !== 1950)        return done("price -> " + r.price);
    if(r.sku !== "PULL AR-195") return done("reference -> " + r.sku);
    if(r.name !== "Pull")       return done("name -> " + r.name);
    if(r.digits !== "1044797380876") return done("digits -> " + r.digits);
    if(r.brand !== "Pyjama Dz") return done("brand -> " + r.brand);
    done(null);
  });

  
  tests.push(function readsTheBrandNameCorrectly(done){
    const r1 = parse("PYJAMA DZ\nPULL AR-195\n1950 DA\n", "1044797380876");
    if(r1.brand !== "Pyjama Dz") return done("expected Pyjama Dz, got " + r1.brand);
    const r2 = parse("MARQUE: MODA DZ\nROBE LONGUE\nREF: M-204\n3500 DA\n");
    if(r2.brand !== "Moda Dz") return done("expected Moda Dz, got " + r2.brand);
    if(r2.sku !== "M-204") return done("expected SKU M-204, got " + r2.sku);
    done(null);
  });

  tests.push(function readsTheRobeTag(done){
    const r = parse("4458534760123\nBASKAT Z8-1\n1600 DA\nMADE IN ALGERIA\n", "4458534760123");
    if(r.price !== 1600)          return done("price -> " + r.price);
    if(r.sku !== "BASKAT Z8-1")   return done("reference -> " + r.sku);
    if(r.name !== "Baskat")       return done("name -> " + r.name);
    done(null);
  });

  tests.push(function survivesSpacedAndNoisyPrices(done){
    if(parse("1 950 DA").price !== 1950)  return done("spaced price failed");
    if(parse("2.200 DA").price !== 2200)  return done("dotted price failed");
    if(parse("PRIX 1950DA").price !== 1950) return done("no-gap price failed");
    done(null);
  });

  tests.push(function takesTheLargestPriceOnTheTag(done){
    // size labels and the like can look price-ish; the real one is biggest
    const r = parse("PULL AR-195\n40 DA\n1950 DA\n");
    if(r.price !== 1950) return done("picked the wrong number -> " + r.price);
    done(null);
  });

  tests.push(function neverNamesAProductAfterTheBrand(done){
    const r = parse("PYJAMA DZ\nFASHION\nMADE IN ALGERIA\n1950 DA\n");
    if(r.sku)  return done("brand text was taken as a reference -> " + r.sku);
    if(r.name) return done("brand text was taken as a name -> " + r.name);
    if(r.price !== 1950) return done("price should still be read");
    done(null);
  });

  tests.push(function reportsAMismatchedPrintedNumber(done){
    // OCR read different digits than the scanner decoded -> caller warns
    const r = parse("1044797380999\nPULL AR-195\n1950 DA\n", "1044797380876");
    if(r.digits !== "1044797380999") return done("digits -> " + r.digits);
    if(r.digits === "1044797380876") return done("should not have matched");
    done(null);
  });

  tests.push(function handlesEmptyOcr(done){
    const r = parse("");
    if(r.price !== null || r.sku !== null || r.name !== null){
      return done("empty text should yield nothing");
    }
    if(!Array.isArray(r.lines) || r.lines.length) return done("lines should be empty");
    done(null);
  });

} else if(PAGE === "decoder"){

  // a video the decoder believes is a live 2560x1440 stream
  const video = makeEl("video");
  video.videoWidth = 2560; video.videoHeight = 1440; video.readyState = 4;

  let applied = [];
  const track = {
    getCapabilities: () => ({ zoom: { min:1, max:5, step:0.1 }, torch:true,
                              focusMode:["continuous","single-shot"] }),
    getSettings: () => ({ zoom: 1 }),
    applyConstraints(c){ applied.push(c); return Promise.resolve(); },
    stop(){}
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };

  let dec = null, hits = [], zooms = [];

  tests.push(function startsOnTheZxingPath(done){
    dec = sandbox.FastDecoder.create(video);
    dec.start(stream,
      (text, fmt) => hits.push({ text, fmt }),
      () => {},
      () => {},
      (z, caps) => zooms.push({ z, caps })
    ).then(engine => {
      if(engine !== "zxing") return done("expected the zxing path, got " + engine);
      done(null);
    }).catch(e => done("start rejected", e));
  });

  tests.push(function readsTheCamerasZoomRange(done){
    const caps = dec.zoomRange();
    if(!caps) return done("zoom capabilities were not read from the track");
    if(caps.max !== 5) return done("wrong zoom max -> " + JSON.stringify(caps));
    if(!zooms.length) return done("onZoom was never called at start");
    done(null);
  });

  /* The user asked for zoom to be manual only. Nothing in the engine may
     move the camera on its own, however long a scan fails. */
  tests.push(function neverZoomsWithoutTheUser(done){
    applied = [];
    setTimeout(() => {
      const zoomed = applied.filter(c =>
        c.advanced && c.advanced[0] && c.advanced[0].zoom !== undefined);
      if(zoomed.length){
        return done("the engine zoomed by itself " + zoomed.length +
                    " time(s) during a failing scan: " + JSON.stringify(zoomed));
      }
      done(null);
    }, 2600);  // past the 2.2 s at which the removed auto-zoom used to fire,
               // so this test can actually fail if it ever comes back
  });

  tests.push(function zoomIsAppliedToTheTrack(done){
    applied = [];
    dec.setZoom(3).then(okz => {
      if(!okz) return done("setZoom reported failure");
      const z = applied.find(c => c.advanced && c.advanced[0] && c.advanced[0].zoom !== undefined);
      if(!z) return done("no zoom constraint reached the track -> " + JSON.stringify(applied));
      if(z.advanced[0].zoom !== 3) return done("wrong zoom applied -> " + z.advanced[0].zoom);
      if(dec.getZoom() !== 3) return done("decoder did not record the new zoom");
      done(null);
    });
  });

  tests.push(function zoomIsClampedToWhatTheCameraHas(done){
    dec.setZoom(99).then(() => {
      if(dec.getZoom() !== 5) return done("zoom was not clamped to max -> " + dec.getZoom());
      done(null);
    });
  });

  tests.push(function sweepsSeveralWindowsPerSecond(done){
    // let the loop run; every attempt misses, so it must keep moving
    zxCalls = 0; zxSizes = [];
    setTimeout(() => {
      if(zxCalls < 8) return done("only " + zxCalls + " decode attempts in 400ms — the sweep is not advancing");
      const distinct = new Set(zxSizes);
      if(distinct.size < 4){
        return done("the sweep reused the same window: " + [...distinct].join(", "));
      }
      done(null);
    }, 400);
  });

  tests.push(function reportsAHitFromAnyWindow(done){
    hits = [];
    zxCalls = 0;
    zxHitOn = 6;               // succeed on the 6th window, not the first
    setTimeout(() => {
      zxHitOn = 0;
      if(!hits.length) return done("a hit on a later window never reached onHit");
      if(hits[0].text !== "4458534760123") return done("wrong code -> " + hits[0].text);
      if(hits[0].fmt !== "EAN_13") return done("wrong format -> " + hits[0].fmt);
      dec.stop();
      done(null);
    }, 500);
  });

} else if(PAGE === "database"){

  if(!sandbox.__seeded){

    tests.push(function emptyState(done){
      setTimeout(() => {
        const list = document.getElementById("list").innerHTML;
        if(!/Nothing on the list/.test(list)) return done("database: empty state missing -> " + list);
        done(null);
      }, 80);
    });

    tests.push(function printRefusesAnEmptyList(done){
      document.getElementById("btnPrint").dispatch("click");
      setTimeout(() => {
        if(!/Nothing to print/.test(status())) return done("print: did not refuse -> " + status());
        if(sandbox.__printed) return done("print: opened the dialog for an empty list");
        done(null);
      }, 120);
    });

    tests.push(function pdfRefusesAnEmptyList(done){
      document.getElementById("btnPdf").dispatch("click");
      setTimeout(() => {
        if(!/Nothing to export/.test(status())) return done("pdf: did not refuse -> " + status());
        done(null);
      }, 60);
    });

  } else {

    tests.push(function groupsTheSeededRows(done){
      setTimeout(() => {
        const list = document.getElementById("list").innerHTML;
        if(!/Robe/.test(list))            return done("list: named product missing -> " + list);
        if(!/×2/.test(list))              return done("list: the two Robe scans did not group into ×2");
        if(!/Not named yet/.test(list))   return done("list: the unknown code should show as unnamed");
        if(document.getElementById("sCount").textContent !== "3")
          return done("totals: expected 3 pieces, got " + document.getElementById("sCount").textContent);
        if(document.getElementById("sItems").textContent !== "2")
          return done("totals: expected 2 products");
        // 2 x 1600 priced, third has no price -> floor marker
        if(!/^≥/.test(document.getElementById("sTotal").textContent))
          return done("totals: missing the ≥ marker for an unpriced row");
        done(null);
      }, 80);
    });

    tests.push(function printBuildsTheSheet(done){
      document.getElementById("btnPrint").dispatch("click");
      setTimeout(() => {
        const sheet = document.getElementById("sheet").innerHTML;
        if(!sheet)                          return done("print: the sheet was never built");
        if(!/<table/.test(sheet))           return done("print: no table in the sheet");
        if(!/Robe/.test(sheet))             return done("print: product name missing from the sheet");
        if(!/روب/.test(sheet))              return done("print: Arabic name missing from the sheet");
        if(!/BASKAT Z8-1/.test(sheet))      return done("print: SKU missing");
        if(!/4458534760123/.test(sheet))    return done("print: barcode missing");
        if(!/Inventaire|inventaire/.test(sheet) && !/Liste/.test(sheet))
          return done("print: no document title");
        if(!/<tfoot/.test(sheet))           return done("print: no totals row");
        if(!sandbox.__printed)              return done("print: window.print() was never called");
        done(null);
      }, 200);
    });

    tests.push(function pdfReportsAMissingLibrary(done){
      document.getElementById("btnPdf").dispatch("click");
      setTimeout(() => {
        if(!/PDF library did not load/.test(status()))
          return done("pdf: should have reported the missing library -> " + status());
        if(!/Imprimer/.test(status()))
          return done("pdf: should point the user at Imprimer as the fallback");
        done(null);
      }, 60);
    });

  }

  tests.push(function titleIsRemembered(done){
    const t = document.getElementById("docTitle");
    t.value = "Inventaire test";
    t.dispatch("input");
    if(storage.get("pyjamadz.doctitle") !== "Inventaire test"){
      return done("title: not written to storage");
    }
    done(null);
  });

} else if(PAGE === "scanner"){

tests.push(function photoPath(done){
  const input = document.getElementById("filePhoto");
  input.files = [{ name: "tag.jpg", type: "image/jpeg" }];
  try{
    input.dispatch("change");
  }catch(e){ return done("photo: change handler threw", e); }

  // FileReader -> Image -> decodeImage are each a macrotask hop
  setTimeout(() => {
    const s = status();
    if(/Reading the photo/.test(s)){
      return done("photo: still stuck on 'Reading the photo…' — the handler never completed");
    }
    if(!/No barcode found|decoding failed/.test(s)){
      return done("photo: unexpected end state -> " + s);
    }
    done(null);
  }, 250);
});

tests.push(function manualEntry(done){
  document.getElementById("manualCode").value = "4458534760123";
  try{
    document.getElementById("manualGo").dispatch("click");
  }catch(e){ return done("manual: click handler threw", e); }
  setTimeout(() => {
    const s = status();
    // whatever happens to the name reading, the scan itself must be
    // confirmed and the code must reach the list
    const recent = document.getElementById("recent").innerHTML;
    if(!/4458534760123/.test(recent)) return done("manual: code did not reach the recent strip");
    if(!/on the list|added to the list/.test(s))
      return done("manual: the scan was not confirmed to the user -> " + s);
    done(null);
  }, 60);
});

tests.push(function saveProduct(done){
  document.getElementById("newName").value = "Robe";
  document.getElementById("newSku").value = "BASKAT Z8-1";
  document.getElementById("newPrice").value = "1600";
  try{
    document.getElementById("newSave").dispatch("click");
  }catch(e){ return done("save: click handler threw", e); }
  setTimeout(() => {
    const recent = document.getElementById("recent").innerHTML;
    if(!/Robe/.test(recent)) return done("save: the recent strip did not pick up the name -> " + recent);
    done(null);
  }, 60);
});

/* The camera must read the printed name by itself on a code nobody has
   named — that is the whole point of it. And exactly once per code. */
tests.push(function readsTheNameAutomatically(done){
  let reads = 0;
  sandbox.TagOCR.read = function(){
    reads++;
    return Promise.resolve({
      brand: "Pyjama Dz",
      name: "Pull", sku: "PULL AR-195", price: 1950,
      digits: "1044797380876", lines: ["PULL AR-195", "1950 DA"]
    });
  };

  document.getElementById("manualCode").value = "1044797380876";
  document.getElementById("manualGo").dispatch("click");

  setTimeout(() => {
    if(reads === 0) return done("the tag was never read automatically");
    if(reads > 1)   return done("read " + reads + " times for one code — it is looping");
    if(document.getElementById("newBrand").value !== "Pyjama Dz")
      return done("brand not filled -> " + document.getElementById("newBrand").value);
    if(document.getElementById("newName").value !== "Pull")
      return done("name not filled -> " + document.getElementById("newName").value);
    if(document.getElementById("newPrice").value !== "1950")
      return done("price not filled -> " + document.getElementById("newPrice").value);
    if(!document.getElementById("newName").classList.contains("prefilled"))
      return done("the suggested name is not marked as unconfirmed");
    if(document.getElementById("tName").textContent !== "Pull")
      return done("the ticket still does not show the name -> " +
                  document.getElementById("tName").textContent);
    done(null);
  }, 300);
});

tests.push(function doesNotRereadAKnownProduct(done){
  let reads = 0;
  sandbox.TagOCR.read = function(){ reads++; return Promise.resolve({ lines: [] }); };
  // 4458534760123 was saved to the catalog by the saveProduct test above
  document.getElementById("manualCode").value = "4458534760123";
  document.getElementById("manualGo").dispatch("click");
  setTimeout(() => {
    if(reads > 0) return done("wasted a label read on a product already in the catalog");
    done(null);
  }, 250);
});

tests.push(function linkShowsTheCount(done){
  const label = document.getElementById("linkCount").textContent;
  if(!/piece/.test(label)) return done("link: no piece count -> " + label);
  done(null);
});

tests.push(function cameraWithoutMediaDevices(done){
  try{
    document.getElementById("btnStart").dispatch("click");
  }catch(e){ return done("camera: start handler threw", e); }
  setTimeout(() => {
    if(!/No camera here/.test(status())) return done("camera: wrong message -> " + status());
    done(null);
  }, 30);
});

}

/* ---------- run ---------- */
console.log("\nDriving the " + PAGE + " page in a stubbed DOM\n");
(function next(i){
  if(i >= tests.length){
    console.log("\n" + (failures ? failures + " FAILURE(S)" : "All checks passed") + "\n");
    process.exit(failures ? 1 : 0);
  }
  const t = tests[i];
  let settled = false;
  const done = (msg, err) => {
    if(settled) return; settled = true;
    if(msg) bad(t.name, err || msg); else ok(t.name);
    next(i + 1);
  };
  try{ t(done); }catch(e){ done(t.name + " threw", e); }
  setTimeout(() => done(t.name + " timed out"), 8000);
})(0);
