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

  var BRANDISH = /PYJAMA|FASHION|MADE|ALGER|COTON|POLYESTER|WASH|CARE|PRIX|TAILLE|SIZE/i;

  function parse(text, knownCode){
    var lines = String(text || "")
      .split(/\r?\n/)
      .map(function(l){ return l.replace(/\s+/g, " ").trim(); })
      .filter(function(l){ return l.length > 0; });

    var price = null, sku = null, name = null, digits = null;

    // Price: "1950 DA", "1 950 DA", "1950DA". Take the largest match —
    // a tag rarely prints a bigger number than its price.
    for(var i = 0; i < lines.length; i++){
      var m = lines[i].match(/(\d[\d\s.,]{1,9})\s*DA\b/i);
      if(!m) continue;
      var n = Number(m[1].replace(/[^\d]/g, ""));
      if(n > 0 && n < 10000000 && (price === null || n > price)) price = n;
    }

    // The digits printed under the bars — useful as a cross-check.
    for(i = 0; i < lines.length; i++){
      var d = lines[i].replace(/[^\d]/g, "");
      if(/^\d{8,14}$/.test(d) && d.length === lines[i].replace(/\s/g, "").length){
        digits = d;
        break;
      }
    }

    // The reference line: has letters, is not the price, is not the
    // barcode digits, and is not boilerplate like PYJAMA DZ / FASHION.
    for(i = 0; i < lines.length; i++){
      var l = lines[i];
      if(/\bDA\b/i.test(l)) continue;
      if(!/[A-Za-z]/.test(l)) continue;
      if(BRANDISH.test(l)) continue;
      if(knownCode && l.replace(/[^\d]/g, "") === knownCode) continue;
      if(l.length < 3 || l.length > 28) continue;
      sku = l.toUpperCase().replace(/[^A-Z0-9\-. ]/g, "").replace(/\s+/g, " ").trim();
      if(sku.length >= 3) break;
      sku = null;
    }

    // On these tags the reference starts with the garment type —
    // "PULL AR-195" -> name "PULL". A decent first guess, always editable.
    if(sku){
      var first = sku.split(" ")[0];
      if(/^[A-Z]{3,14}$/.test(first)) name = first.charAt(0) + first.slice(1).toLowerCase();
    }

    return { name: name, sku: sku, price: price, digits: digits, lines: lines, text: text };
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
