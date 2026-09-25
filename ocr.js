/* ============================================================
   Reading the printed text on the tag
   ------------------------------------------------------------
   A barcode carries a number and nothing else. The product name,
   the reference and the price are ink on the label beside it.
   This module points OCR at that ink so a brand-new code can be
   named without typing.

   It is a SUGGESTION, never a decision: whatever comes back is
   put into the form for a human to check before saving. OCR on a
   phone photo of small print gets things wrong, and a wrong price
   saved silently is worse than no price at all.

   Tesseract is ~4 MB and is therefore loaded lazily — the first
   time an unknown code actually needs reading, not on page load.
   ============================================================ */

(function(global){
  "use strict";

  var TESS_URL = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js";

  var worker = null, loading = null;

  function loadScript(src){
    return new Promise(function(resolve, reject){
      if(global.Tesseract) return resolve();
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error("could not load the text reader")); };
      document.head.appendChild(s);
    });
  }

  function ensure(onProgress){
    if(worker) return Promise.resolve(worker);
    if(loading) return loading;

    loading = loadScript(TESS_URL).then(function(){
      if(!global.Tesseract || !global.Tesseract.createWorker){
        throw new Error("the text reader did not load");
      }
      if(onProgress) onProgress("starting the text reader", 0);
      return global.Tesseract.createWorker("eng", 1, {
        logger: function(m){
          if(onProgress && m && m.status) onProgress(m.status, m.progress || 0);
        }
      });
    }).then(function(w){
      // Tag print is Latin letters, digits and a few separators. Telling
      // the engine that stops it guessing accented or CJK lookalikes.
      return w.setParameters({
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-./, "
      }).then(function(){ worker = w; return w; });
    }).catch(function(err){
      loading = null;           // let a later attempt retry cleanly
      throw err;
    });

    return loading;
  }

  /* ---------- pull the useful fields out of raw OCR text ---------- */

  var BRANDISH = /PYJAMA|FASHION|MADE|ALGER|COTON|POLYESTER|WASH|CARE|PRIX|TAILLE|SIZE|MARQUE|BRAND|TAG/i;
  var CARE_OR_BOILERPLATE = /MADE\s+IN|ALGERI|FABRIQU|COTON|POLYESTER|WASH|CARE|TAILLE|SIZE|LAVAGE|NETTOYAGE|100%|80%|20%/i;

  function cleanBrand(s){
    if(!s) return null;
    s = s.replace(/[^A-Za-z0-9\s\-.&]/g, "").replace(/\s+/g, " ").trim();
    if(/^pyjama\s*dz(\s*fashion)?$/i.test(s)) return "Pyjama Dz";
    if(s === s.toUpperCase()){
      return s.split(/\s+/).map(function(w){
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }).join(" ");
    }
    return s;
  }

  function parse(text, knownCode){
    var lines = String(text || "")
      .split(/\r?\n/)
      .map(function(l){ return l.replace(/\s+/g, " ").trim(); })
      .filter(function(l){ return l.length > 0; });

    var price = null, sku = null, name = null, digits = null, brand = null;

    // Price: "1950 DA", "1 950 DA", "1950DA". Take the largest match
    for(var i = 0; i < lines.length; i++){
      var m = lines[i].match(/(\d[\d\s.,]{1,9})\s*DA\b/i);
      if(!m) continue;
      var n = Number(m[1].replace(/[^\d]/g, ""));
      if(n > 0 && n < 10000000 && (price === null || n > price)) price = n;
    }

    // The digits printed under the bars - useful as a cross-check or code fallback.
    for(i = 0; i < lines.length; i++){
      var d = lines[i].replace(/[^\d]/g, "");
      if(/^\d{8,14}$/.test(d) && d.length >= (lines[i].replace(/\s/g, "").length * 0.75)){
        digits = d;
        break;
      }
    }

    // Reference (SKU) detection
    // 1. Explicit reference line starting with REF, RÉF, ART
    for(i = 0; i < lines.length; i++){
      var mRef = lines[i].match(/^(?:REF|RǸF|RÉF|ART)\s*[:.\-]?\s*(.+)/i);
      if(mRef && mRef[1]){
        var sRef = mRef[1].toUpperCase().replace(/[^A-Z0-9\-. ]/g, "").replace(/\s+/g, " ").trim();
        if(sRef.length >= 2){ sku = sRef; break; }
      }
    }
    // 2. Generic reference line: has letters, is not the price, is not the
    // barcode digits, and is not boilerplate like PYJAMA DZ / FASHION.
    if(!sku){
      for(i = 0; i < lines.length; i++){
        var l = lines[i];
        if(/\bDA\b/i.test(l)) continue;
        if(!/[A-Za-z]/.test(l)) continue;
        if(BRANDISH.test(l)) continue;
        if(knownCode && l.replace(/[^\d]/g, "") === knownCode) continue;
        if(l.length < 3 || l.length > 28) continue;
        var sCand = l.toUpperCase().replace(/[^A-Z0-9\-. ]/g, "").replace(/\s+/g, " ").trim();
        if(sCand.length >= 3){ sku = sCand; break; }
      }
    }

    // Product name guess from SKU
    if(sku){
      var first = sku.split(" ")[0];
      if(/^[A-Z]{3,14}$/.test(first)) name = first.charAt(0) + first.slice(1).toLowerCase();
    }
    // Fallback product name from clean garment line
    if(!name){
      for(i = 0; i < lines.length; i++){
        var lName = lines[i];
        if(/\bDA\b/i.test(lName)) continue;
        if(BRANDISH.test(lName)) continue;
        if(CARE_OR_BOILERPLATE.test(lName)) continue;
        if(sku && (lName.toUpperCase() === sku.toUpperCase() || sku.indexOf(lName.toUpperCase()) > -1)) continue;
        if(knownCode && lName.replace(/[^\d]/g, "") === knownCode) continue;
        if(/^\d+$/.test(lName.replace(/\s/g, ""))) continue;
        if(/ROBE|PULL|PYJAMA|CHEMISE|PANTALON|TSHIRT|T-SHIRT|ENSEMBLE|VESTE|MANTEAU|SHORT/i.test(lName)){
          name = lName.charAt(0).toUpperCase() + lName.slice(1).toLowerCase();
          break;
        }
      }
    }

    // Brand detection
    // 1. Explicit brand line: "MARQUE: ...", "BRAND: ..."
    for(i = 0; i < lines.length; i++){
      var mb = lines[i].match(/^(?:MARQUE|BRAND|TAG)\s*[:\-]\s*(.+)/i);
      if(mb && mb[1]){
        var cand = mb[1].replace(/[^A-Za-z0-9\s\-.&]/g, "").replace(/\s+/g, " ").trim();
        if(cand.length >= 2){ brand = cleanBrand(cand); break; }
      }
    }
    // 2. Known brand pattern (e.g. "PYJAMA DZ")
    if(!brand){
      for(i = 0; i < lines.length; i++){
        var lBrand = lines[i];
        if(CARE_OR_BOILERPLATE.test(lBrand)) continue;
        if(/\bDA\b/i.test(lBrand)) continue;
        if(/^\d+$/.test(lBrand.replace(/\s/g, ""))) continue;
        if(sku && lBrand.toUpperCase() === sku.toUpperCase()) continue;

        if(/\bPYJAMA\s*DZ\b/i.test(lBrand)){
          brand = "Pyjama Dz";
          break;
        }
        if(/\b(MODA\s*DZ|CHIC\s*DZ)\b/i.test(lBrand)){
          brand = cleanBrand(lBrand);
          break;
        }
      }
    }
    // 3. Fallback: line containing brand-like label (FASHION, BOUTIQUE, etc.)
    if(!brand){
      for(i = 0; i < lines.length; i++){
        var lBrand2 = lines[i];
        if(CARE_OR_BOILERPLATE.test(lBrand2)) continue;
        if(/\bDA\b/i.test(lBrand2)) continue;
        if(/^\d+$/.test(lBrand2.replace(/\s/g, ""))) continue;
        if(sku && (lBrand2.toUpperCase() === sku.toUpperCase() || sku.indexOf(lBrand2.toUpperCase()) > -1)) continue;
        if(knownCode && lBrand2.replace(/[^\d]/g, "") === knownCode) continue;
        if(/FASHION|BOUTIQUE|COLLECTION|STYLE|COUTURE/i.test(lBrand2)){
          var cl = lBrand2.replace(/[^A-Za-z0-9\s\-.&]/g, "").replace(/\s+/g, " ").trim();
          if(cl.length >= 3 && cl.length <= 25){ brand = cleanBrand(cl); break; }
        }
      }
    }

    return {
      brand: brand,
      name: name,
      sku: sku,
      price: price,
      digits: digits,
      code: knownCode || digits,
      lines: lines,
      text: text
    };
  }

  /* ---------- public ---------- */

  global.TagOCR = {
    available: true,

    /* canvas | image | video frame -> {name, sku, price, digits, lines} */
    read: function(source, knownCode, onProgress){
      if(!source) return Promise.reject(new Error("nothing to read"));
      return ensure(onProgress).then(function(w){
        if(onProgress) onProgress("reading the tag", 0);
        return w.recognize(source);
      }).then(function(res){
        return parse(res && res.data ? res.data.text : "", knownCode);
      });
    },

    /* Exposed so the parser can be exercised without loading Tesseract. */
    parse: parse,

    warmUp: function(onProgress){ return ensure(onProgress); }
  };

})(window);
