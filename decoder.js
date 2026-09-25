/* ============================================================
   Pyjama Dz Tag Scanner — decode engine
   ------------------------------------------------------------
   WHAT THIS CAN AND CANNOT DO — read this before tuning it.

   A barcode is only readable if its narrowest bar lands on at
   least ~2 camera pixels, and comfortably at 3. EAN-13 is 95
   modules wide, so the barcode has to span roughly 250-300
   pixels in the captured frame. Past that distance the detail
   is not dim or noisy — it is not in the image at all, and no
   amount of processing invents it back. The levers that
   genuinely extend range are therefore optical, and both are
   used here: capture at the highest resolution the camera
   offers, and let the user spend those pixels on a smaller
   patch of the world with the zoom buttons.

   Zoom is deliberately MANUAL. The camera never changes it on
   its own: a viewfinder that moves while you are lining up a
   tag is worse than a short reach.

   Occlusion is a harder wall. EAN-13, Code 39 and ITF carry NO
   error correction — the check digit detects a misread, it
   cannot rebuild missing bars. Cover part of the bar region and
   the number is mathematically unrecoverable. (QR and DataMatrix
   have Reed-Solomon and survive ~30% loss; 1D retail codes do
   not.) What this engine can do is find a tag that is small,
   off-centre, tilted or upside down — which is usually what
   "hidden" turns out to mean in practice.

   HOW IT FINDS THINGS
   A scan PLAN covers the frame at several scales and angles:
   the centre band, the whole frame, four overlapping quadrants
   at 2x magnification, a 3x centre close-up, and tilted passes.
   Each frame works through the plan under a time BUDGET and
   resumes where it stopped, so coverage is wide without the
   frame rate collapsing. A pass that succeeds is remembered and
   tried first next time.
   ============================================================ */

(function(global){
  "use strict";

  var RETAIL = ["EAN_13", "EAN_8", "UPC_A", "UPC_E"];
  var EXTRA  = ["CODE_128", "CODE_39", "ITF", "CODABAR"];

  var TARGET_PX    = 760;   // decode width; more than this buys nothing
  var MAX_UPSCALE  = 2.2;   // lets the tight passes magnify
  var FRAME_BUDGET = 30;    // ms of decoding per frame
  var WIDEN_MS     = 3500;  // no read this long -> enable every format
  var HINT_MS      = 1600;
  var QUIET_MS     = 1500;
  var DARK_LUMA    = 46, DIM_LUMA = 70, FLAT_EDGE = 9;

  /* Normalised windows on the frame. Order matters: cheap and
     most-likely first, magnified and exotic last. */
  function buildPlan(){
    var P = [];
    // 1. the centre band — a tag held up to the camera
    P.push({ x:0.08, y:0.30, w:0.84, h:0.40, rot:0,  tag:"centre" });
    P.push({ x:0.08, y:0.30, w:0.84, h:0.40, rot:90, tag:"centre ⟲" });
    // 2. the whole frame — a tag anywhere, if it is big enough
    P.push({ x:0.00, y:0.00, w:1.00, h:1.00, rot:0,  tag:"frame" });
    P.push({ x:0.00, y:0.00, w:1.00, h:1.00, rot:90, tag:"frame ⟲" });
    // 3. four overlapping quadrants at ~2x — a small tag off to one side
    var q = 0.56, step = 1 - q;
    for(var gy = 0; gy < 2; gy++){
      for(var gx = 0; gx < 2; gx++){
        P.push({ x: gx*step, y: gy*step, w:q, h:q, rot:0,  tag:"tile" });
        P.push({ x: gx*step, y: gy*step, w:q, h:q, rot:90, tag:"tile ⟲" });
      }
    }
    // 4. a 3x centre close-up — a distant tag
    P.push({ x:0.34, y:0.36, w:0.32, h:0.28, rot:0,  tag:"reach" });
    P.push({ x:0.34, y:0.36, w:0.32, h:0.28, rot:90, tag:"reach ⟲" });
    // 5. tilted — a tag lying at an angle
    P.push({ x:0.10, y:0.25, w:0.80, h:0.50, rot:28,  tag:"tilt" });
    P.push({ x:0.10, y:0.25, w:0.80, h:0.50, rot:-28, tag:"tilt" });
    return P;
  }

  function FastDecoder(video){
    this.video   = video;
    this.canvas  = document.createElement("canvas");
    this.ctx     = this.canvas.getContext("2d", { willReadFrequently: true });
    this.running = false;
    this.track   = null;

    this.plan    = buildPlan();
    this.cursor  = 0;
    this.bestPass = 0;        // the window that worked last time

    this.formats = RETAIL.slice();
    this.widened = false;
    this.lastHitAt = 0; this.startedAt = 0; this.frames = 0;
    this.lastHintAt = 0; this.lastHint = ""; this.torchAuto = false;
    this.zoom = null; this.zoomCaps = null;
    this.native = null; this.zxing = null; this.pending = null;
  }

  /* ---------- decoder back ends ---------- */

  FastDecoder.prototype._setupNative = function(){
    var self = this;
    if(!global.BarcodeDetector || !global.BarcodeDetector.getSupportedFormats){
      return Promise.resolve(false);
    }
    return global.BarcodeDetector.getSupportedFormats().then(function(supported){
      var want = self.formats.map(function(f){ return f.toLowerCase(); })
        .filter(function(f){ return supported.indexOf(f) > -1; });
      if(!want.length) return false;
      self.native = new global.BarcodeDetector({ formats: want });
      return true;
    }).catch(function(){ return false; });
  };

  FastDecoder.prototype._setupZxing = function(){
    if(!global.ZXing) return false;
    var Z = global.ZXing;
    try{
      var hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, this.formats.map(function(f){
        return Z.BarcodeFormat[f];
      }));
      // TRY_HARDER stays off on video: the plan already covers the
      // rotations it would attempt, and more frames beats more effort.
      var reader = new Z.MultiFormatReader();
      reader.setHints(hints);
      var fastPath = typeof Z.HTMLCanvasElementLuminanceSource === "function" &&
                     typeof Z.BinaryBitmap === "function" &&
                     typeof Z.HybridBinarizer === "function" &&
                     typeof reader.decodeWithState === "function";
      this.zxing = fastPath
        ? { reader: reader, mode: "canvas" }
        : { reader: new Z.BrowserMultiFormatReader(hints), mode: "browser" };
      return true;
    }catch(e){ return false; }
  };

  FastDecoder.prototype._widen = function(){
    if(this.widened) return Promise.resolve();
    this.widened = true;
    this.formats = RETAIL.concat(EXTRA);
    this.native = null; this.zxing = null;
    var self = this;
    return this._setupNative().then(function(){ self._setupZxing(); });
  };

  /* ---------- draw one window of the frame ---------- */

  FastDecoder.prototype._draw = function(p){
    var v = this.video, ctx = this.ctx, c = this.canvas;
    var vw = v.videoWidth, vh = v.videoHeight;

    var sw = Math.max(16, Math.round(vw * p.w));
    var sh = Math.max(16, Math.round(vh * p.h));
    var sx = Math.round(vw * p.x);
    var sy = Math.round(vh * p.y);

    var scale = Math.min(MAX_UPSCALE, TARGET_PX / sw);
    var dw = Math.max(80, Math.round(sw * scale));
    var dh = Math.max(40, Math.round(sh * scale));

    if(p.rot === 0){
      c.width = dw; c.height = dh;
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, dw, dh);
      return;
    }
    if(p.rot === 90){
      // a vertical tag becomes horizontal, the only way 1D readers scan
      c.width = dh; c.height = dw;
      ctx.save();
      ctx.translate(dh, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, dw, dh);
      ctx.restore();
      return;
    }
    // arbitrary angle: size the canvas to the rotated bounding box
    var rad = p.rot * Math.PI / 180;
    var ca = Math.abs(Math.cos(rad)), sa = Math.abs(Math.sin(rad));
    var bw = Math.round(dw * ca + dh * sa);
    var bh = Math.round(dw * sa + dh * ca);
    c.width = bw; c.height = bh;
    ctx.save();
    ctx.translate(bw / 2, bh / 2);
    ctx.rotate(rad);
    ctx.drawImage(v, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  };

  /* ---------- decode whatever is on the canvas ---------- */

  FastDecoder.prototype._decode = function(){
    if(this.native){
      return this.native.detect(this.canvas).then(function(res){
        if(res && res.length){
          return { text: res[0].rawValue, format: (res[0].format || "").toUpperCase() };
        }
        return null;
      }).catch(function(){ return null; });
    }
    if(this.zxing){
      var Z = global.ZXing;
      try{
        if(this.zxing.mode === "canvas"){
          var src = new Z.HTMLCanvasElementLuminanceSource(this.canvas);
          var bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));
          var r = this.zxing.reader.decodeWithState(bmp);
          if(r) return Promise.resolve({ text: r.getText(), format: fmtName(r) });
        } else {
          var r2 = this.zxing.reader.decodeFromCanvas(this.canvas);
          if(r2) return Promise.resolve({ text: r2.getText(), format: fmtName(r2) });
        }
      }catch(e){ /* NotFound on most passes — the normal path */ }
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  };

  function fmtName(result){
    try{
      var v = result.getBarcodeFormat();
      for(var k in global.ZXing.BarcodeFormat){
        if(global.ZXing.BarcodeFormat[k] === v) return k;
      }
    }catch(e){}
    return "";
  }

  /* ---------- optical reach: the camera's own zoom ---------- */

  FastDecoder.prototype._readZoomCaps = function(){
    try{
      var caps = this.track && this.track.getCapabilities ? this.track.getCapabilities() : null;
      if(caps && caps.zoom && typeof caps.zoom.max === "number" && caps.zoom.max > caps.zoom.min){
        this.zoomCaps = { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
        var s = this.track.getSettings ? this.track.getSettings() : {};
        this.zoom = typeof s.zoom === "number" ? s.zoom : this.zoomCaps.min;
      }
    }catch(e){}
    return this.zoomCaps;
  };

  FastDecoder.prototype.zoomRange = function(){ return this.zoomCaps; };
  FastDecoder.prototype.getZoom   = function(){ return this.zoom; };

  /* A still of the current frame, for reading the printed text on the
     tag. Full frame: the name and price sit beside the bars, not
     inside the window the barcode was found in. */
  FastDecoder.prototype.capture = function(maxEdge){
    var v = this.video;
    if(!v || !v.videoWidth) return null;
    var cap = maxEdge || 1800;
    var scale = Math.min(1, cap / Math.max(v.videoWidth, v.videoHeight));
    var c = document.createElement("canvas");
    c.width  = Math.max(1, Math.round(v.videoWidth  * scale));
    c.height = Math.max(1, Math.round(v.videoHeight * scale));
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return c;
  };

  /* Only ever called from the zoom buttons. Nothing in the engine
     changes zoom by itself — see the note at the top. */
  FastDecoder.prototype.setZoom = function(z){
    if(!this.track || !this.zoomCaps) return Promise.resolve(false);
    var caps = this.zoomCaps;
    z = Math.max(caps.min, Math.min(caps.max, z));
    var self = this;
    return this.track.applyConstraints({ advanced: [{ zoom: z }] }).then(function(){
      self.zoom = z;
      if(self.onZoom) self.onZoom(z, caps);
      return true;
    }).catch(function(){ return false; });
  };

  /* ---------- picture quality, for coaching and auto-torch ---------- */

  FastDecoder.prototype._measure = function(){
    var c = this.canvas, ctx = this.ctx, w = c.width, h = c.height;
    if(w < 8 || h < 8) return null;
    var strip;
    try{ strip = ctx.getImageData(0, Math.floor(h / 2), w, 1).data; }
    catch(e){ return null; }
    var sum = 0, edges = 0, prev = -1, n = 0;
    for(var x = 0; x < w; x++){
      var i = x * 4;
      var lum = strip[i] * 0.299 + strip[i+1] * 0.587 + strip[i+2] * 0.114;
      sum += lum; n++;
      if(prev >= 0) edges += Math.abs(lum - prev);
      prev = lum;
    }
    return { luma: sum / n, edge: edges / Math.max(1, n - 1) };
  };

  FastDecoder.prototype._coach = function(q){
    var now = performance.now();
    if(now - this.lastHitAt < QUIET_MS) return;
    if(now - this.lastHintAt < HINT_MS) return;
    if(!q) return;
    var msg = null;
    if(q.luma < DARK_LUMA)      msg = "Too dark to read the bars.";
    else if(q.luma > 232)       msg = "Glare on the tag — tilt it away from the light.";
    else if(q.edge < FLAT_EDGE) msg = "Bars look blurred — the tag may be too far to resolve. Move closer.";
    else if(q.luma < DIM_LUMA)  msg = "A bit dim. More light would speed this up.";
    if(msg && msg !== this.lastHint){
      this.lastHint = msg; this.lastHintAt = now;
      if(this.onHint) this.onHint(msg);
    }
  };

  FastDecoder.prototype._autoTorch = function(q){
    if(this.torchAuto || !this.track || !q) return;
    if(q.luma >= DARK_LUMA) return;
    if(performance.now() - this.startedAt < 900) return;
    var self = this;
    try{
      var caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
      if(!caps || !caps.torch) return;
      this.track.applyConstraints({ advanced: [{ torch: true }] }).then(function(){
        self.torchAuto = true;
        if(self.onHint) self.onHint("Dark — torch on.");
        if(self.onTorch) self.onTorch(true);
      }).catch(function(){});
    }catch(e){}
  };

  /* Nudge autofocus — useful when the user taps the picture. */
  FastDecoder.prototype.refocus = function(){
    if(!this.track || !this.track.applyConstraints) return;
    var t = this.track;
    try{
      var caps = t.getCapabilities ? t.getCapabilities() : {};
      if(!caps.focusMode) return;
      var has = function(m){ return caps.focusMode.indexOf(m) > -1; };
      if(has("single-shot")){
        t.applyConstraints({ advanced: [{ focusMode: "single-shot" }] }).then(function(){
          if(has("continuous")){
            setTimeout(function(){
              t.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function(){});
            }, 1200);
          }
        }).catch(function(){});
      } else if(has("continuous")){
        t.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function(){});
      }
    }catch(e){}
  };

  /* ---------- accepting a result ---------- */

  function checkDigitOk(code, format){
    var f = (format || "").toUpperCase(), len = code.length;
    var applies = (f.indexOf("EAN_13") > -1 && len === 13) ||
                  (f.indexOf("EAN_8")  > -1 && len === 8)  ||
                  (f.indexOf("UPC_A")  > -1 && len === 12);
    if(!applies || !/^\d+$/.test(code)) return null;
    var body = code.slice(0, -1), sum = 0;
    for(var i = 0; i < body.length; i++){
      var d = +body.charAt(body.length - 1 - i);
      sum += (i % 2 === 0) ? d * 3 : d;
    }
    return ((10 - (sum % 10)) % 10) === +code.slice(-1);
  }

  /* A code whose check digit adds up is trusted on the first read.
     Anything else must come back identical twice — a partly-seen tag
     must never put a wrong number on the list. */
  FastDecoder.prototype._confirm = function(hit){
    if(checkDigitOk(hit.text, hit.format) !== false){ this.pending = null; return true; }
    if(this.pending && this.pending.text === hit.text){ this.pending = null; return true; }
    this.pending = { text: hit.text, at: performance.now() };
    return false;
  };

  /* ---------- the loop ---------- */

  FastDecoder.prototype._schedule = function(){
    var self = this, v = this.video;
    if(v.requestVideoFrameCallback){
      this._handle = v.requestVideoFrameCallback(function(){ self._tick(); });
    } else {
      this._handle = requestAnimationFrame(function(){ self._tick(); });
    }
  };

  /* Work through the plan under a time budget, resuming next frame
     where this one ran out. Over a second or so every window gets
     covered, without any single frame blowing the frame rate. */
  FastDecoder.prototype._sweep = function(t0, tried){
    var self = this;
    if(!this.running) return Promise.resolve(null);
    if(tried >= this.plan.length) return Promise.resolve(null);
    if(tried > 0 && performance.now() - t0 > FRAME_BUDGET) return Promise.resolve(null);

    var idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.plan.length;
    var p = this.plan[idx];

    this._draw(p);
    if(tried === 0 && this.frames % 5 === 0){
      var q = this._measure();
      if(q){ this._autoTorch(q); this._coach(q); }
    }
    return this._decode().then(function(hit){
      if(hit){ self.bestPass = idx; return hit; }
      return self._sweep(t0, tried + 1);
    });
  };

  FastDecoder.prototype._tick = function(){
    if(!this.running) return;
    var v = this.video;
    if(v.readyState < 2 || !v.videoWidth){ this._schedule(); return; }

    var self = this;
    this.frames++;
    // start each frame on the window that worked last time
    if(performance.now() - this.lastHitAt < 4000) this.cursor = this.bestPass;

    this._sweep(performance.now(), 0).then(function(hit){
      if(!self.running) return;

      if(hit && hit.text){
        self.lastHitAt = performance.now();
        self.lastHint = "";
        if(self._confirm(hit) && self.onHit) self.onHit(hit.text, hit.format);
      } else if(!self.widened && performance.now() - self.startedAt > WIDEN_MS &&
                performance.now() - self.lastHitAt > WIDEN_MS){
        self._widen().then(function(){
          if(self.onHint) self.onHint("Now trying every barcode type.");
        });
      }
      self._schedule();
    }).catch(function(){
      if(self.running) self._schedule();
    });
  };

  /* ---------- public ---------- */

  FastDecoder.prototype.start = function(stream, onHit, onHint, onTorch, onZoom){
    var self = this;
    this.onHit = onHit; this.onHint = onHint; this.onTorch = onTorch; this.onZoom = onZoom;
    this.track = stream ? stream.getVideoTracks()[0] : null;
    this.startedAt = performance.now();
    this.lastHitAt = 0; this.cursor = 0; this.bestPass = 0;
    this.frames = 0; this.torchAuto = false; this.pending = null;

    this._readZoomCaps();
    if(this.zoomCaps && this.onZoom) this.onZoom(this.zoom, this.zoomCaps);

    return this._setupNative().then(function(native){
      if(!native) self._setupZxing();
      if(!self.native && !self.zxing) throw new Error("no decoder available");
      self.running = true;
      self._schedule();
      return self.native ? "native" : "zxing";
    });
  };

  FastDecoder.prototype.stop = function(){
    this.running = false;
    try{
      if(this._handle && this.video.cancelVideoFrameCallback){
        this.video.cancelVideoFrameCallback(this._handle);
      } else if(this._handle){
        cancelAnimationFrame(this._handle);
      }
    }catch(e){}
    this._handle = null; this.track = null; this.zoomCaps = null;
  };

  /* ---------- still photos ----------
     A phone photo is ~12 megapixels. Handing that straight to ZXing
     with TRY_HARDER on eight formats locks the main thread for
     seconds, which looks exactly like a hang. Shrink first, then work
     through framings, yielding between each so the page keeps painting. */

  function stillCanvas(source, opt){
    var sw = source.naturalWidth  || source.width;
    var sh = source.naturalHeight || source.height;
    if(!sw || !sh) return null;

    var crop = opt.crop || 1;
    var cw = Math.max(16, Math.round(sw * crop));
    var ch = Math.max(16, Math.round(sh * crop));
    var sx = Math.round((sw - cw) / 2 + (opt.dx || 0) * sw);
    var sy = Math.round((sh - ch) / 2 + (opt.dy || 0) * sh);
    sx = Math.max(0, Math.min(sw - cw, sx));
    sy = Math.max(0, Math.min(sh - ch, sy));

    var cap = opt.maxEdge || 1600;
    var scale = Math.min(opt.allowUpscale ? 2.5 : 1, cap / Math.max(cw, ch));
    var dw = Math.max(32, Math.round(cw * scale));
    var dh = Math.max(32, Math.round(ch * scale));

    var c = document.createElement("canvas");
    if(opt.rotated){ c.width = dh; c.height = dw; }
    else           { c.width = dw; c.height = dh; }

    var ctx = c.getContext("2d");
    ctx.save();
    if(opt.rotated){ ctx.translate(dh, 0); ctx.rotate(Math.PI / 2); }
    ctx.drawImage(source, sx, sy, cw, ch, 0, 0, dw, dh);
    ctx.restore();
    return c;
  }

  var STILL_PASSES = [
    { maxEdge: 1600 },
    { maxEdge: 1600, rotated: true },
    { maxEdge: 1500, crop: 0.6, allowUpscale: true },
    { maxEdge: 1500, crop: 0.6, allowUpscale: true, rotated: true },
    { maxEdge: 1500, crop: 0.4, allowUpscale: true },
    { maxEdge: 1500, crop: 0.4, allowUpscale: true, rotated: true },
    { maxEdge: 1500, crop: 0.45, allowUpscale: true, dx:-0.22 },
    { maxEdge: 1500, crop: 0.45, allowUpscale: true, dx: 0.22 },
    { maxEdge: 1500, crop: 0.45, allowUpscale: true, dy:-0.22 },
    { maxEdge: 1500, crop: 0.45, allowUpscale: true, dy: 0.22 }
  ];

  function zxingStill(source, onProgress){
    if(!global.ZXing) return Promise.resolve(null);
    var Z = global.ZXing, reader, hints;
    try{
      hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS,
        RETAIL.concat(EXTRA).map(function(f){ return Z.BarcodeFormat[f]; }));
      hints.set(Z.DecodeHintType.TRY_HARDER, true);   // worth it: no next frame
      reader = new Z.MultiFormatReader();
      reader.setHints(hints);
    }catch(e){ return Promise.resolve(null); }

    if(typeof Z.HTMLCanvasElementLuminanceSource !== "function"){
      return Promise.resolve(null);
    }

    function attempt(i){
      if(i >= STILL_PASSES.length) return Promise.resolve(null);
      if(onProgress) onProgress(i + 1, STILL_PASSES.length);
      return new Promise(function(resolve){
        setTimeout(function(){          // yield so the status line paints
          var hit = null;
          try{
            var c = stillCanvas(source, STILL_PASSES[i]);
            if(c){
              var src = new Z.HTMLCanvasElementLuminanceSource(c);
              var r = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(src)), hints);
              if(r) hit = { text: r.getText(), format: fmtName(r) };
            }
          }catch(e){ /* NotFound — next framing */ }
          resolve(hit);
        }, 0);
      }).then(function(hit){
        return hit || attempt(i + 1);
      });
    }
    return attempt(0);
  }

  global.FastDecoder = {
    create: function(video){ return new FastDecoder(video); },
    decodeImage: function(source, onProgress){
      if(global.BarcodeDetector){
        return new global.BarcodeDetector().detect(source).then(function(res){
          if(res && res.length){
            return { text: res[0].rawValue, format: (res[0].format || "").toUpperCase() };
          }
          return zxingStill(source, onProgress);
        }).catch(function(){ return zxingStill(source, onProgress); });
      }
      return zxingStill(source, onProgress);
    }
  };

})(window);
