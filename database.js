/* ============================================================
   Database page — the list, the catalog, and getting it on paper.
   ------------------------------------------------------------
   Two ways out:

   IMPRIMER  builds a clean document into #sheet and calls
             window.print(). The browser renders it, so Arabic
             names come out correctly, and every print dialog
             (phone included) offers "Save as PDF".

   EXPORT PDF writes a real .pdf with jsPDF. jsPDF's built-in
             fonts are Latin-only and it does no right-to-left
             shaping, so the PDF carries the Latin name and SKU
             and leaves the Arabic column out. Use Imprimer when
             you need the Arabic on the page.
   ============================================================ */

(function(){
  "use strict";

  var $ = function(id){ return document.getElementById(id); };
  var esc = PDZ.esc, money = PDZ.money, clock = PDZ.clock;

  var store = null, mode = "wait";
  var catalog = {}, scans = [];
  var listEl = $("list"), catEl = $("catList"), statusEl = $("status");

  var TITLE_KEY = "pyjamadz.doctitle";

  function say(html, isErr){
    statusEl.innerHTML = html;
    statusEl.className = isErr ? "status err noprint" : "status noprint";
  }
  function setSync(s, label){
    mode = s;
    $("sync").setAttribute("data-s", s);
    $("syncLabel").textContent = label;
  }
  function errText(err){
    if(!err) return "unknown error";
    return err.message || err.hint || err.code || String(err);
  }
  function docTitle(){
    return $("docTitle").value.trim() || "Liste d'inventaire";
  }

  /* ================= rendering ================= */
  function current(){ return PDZ.summarise(scans, catalog); }

  function render(){
    var s = current();
    $("sCount").textContent = s.pieces;
    $("sItems").textContent = s.products;
    $("sTotal").textContent = (s.priced ? "" : "≥") + s.total.toLocaleString("fr-DZ");

    if(!s.rows.length){
      listEl.innerHTML = '<div class="empty">Nothing on the list. Scan a tag and it appears here.</div>';
    } else {
      var html = "";
      for(var i=0;i<s.rows.length;i++){
        var r = s.rows[i];
        var sub = [esc(r.code)];
        if(r.sku) sub.push(esc(r.sku));
        if(r.unit != null) sub.push(money(r.unit) + " DA each");
        sub.push(esc(clock(r.at)));
        html += '<div class="row">' +
          '<div class="col">' +
            '<span class="pname' + (r.name ? '' : ' none') + '">' +
              (r.name ? esc(r.name) : "Not named yet") + '</span>' +
            '<span class="name">' + sub.join(" · ") + '</span>' +
          '</div>' +
          '<div class="right">' +
            '<span class="qty' + (r.qty === 1 ? ' one' : '') + '">×' + r.qty + '</span>' +
            (r.line != null ? '<span class="amt">' + money(r.line) + ' DA</span>' : '') +
          '</div>' +
          '<button class="x" data-minus="' + esc(r.ids[0]) + '" aria-label="Remove one ' +
            esc(r.name || r.code) + '">−</button>' +
        '</div>';
      }
      listEl.innerHTML = html;
    }
    renderCatalog();
  }

  function renderCatalog(){
    var codes = Object.keys(catalog).sort();
    $("catCount").textContent = codes.length ? codes.length + " saved" : "";
    if(!codes.length){
      catEl.innerHTML = '<div class="empty">No products yet. Name a code on the scanner page and it is saved here.</div>';
      return;
    }
    var html = "";
    for(var i=0;i<codes.length;i++){
      var c = codes[i], it = catalog[c];
      html += '<div class="row">' +
        '<div class="col">' +
          '<span class="pname">' + esc(it.name || "unnamed") + '</span>' +
          '<span class="name">' + esc(c) + (it.sku ? " · " + esc(it.sku) : "") +
            (it.nameAr ? ' · <span class="ar">' + esc(it.nameAr) + '</span>' : "") + '</span>' +
        '</div>' +
        '<span class="amt">' + money(it.price) + (typeof it.price === "number" ? " DA" : "") + '</span>' +
        '<button class="x" data-del="' + esc(c) + '" aria-label="Remove this product">×</button>' +
      '</div>';
    }
    catEl.innerHTML = html;
  }

  listEl.addEventListener("click", function(ev){
    if(!ev.target.closest) return;
    var minus = ev.target.closest("button[data-minus]");
    if(!minus) return;
    store.deleteScan(minus.getAttribute("data-minus")).catch(function(err){
      say("<b>Could not remove that one</b> — " + esc(errText(err)), true);
    });
  });

  catEl.addEventListener("click", function(ev){
    if(!ev.target.closest) return;
    var del = ev.target.closest("button[data-del]");
    if(!del) return;
    store.deleteProduct(del.getAttribute("data-del")).catch(function(err){
      say("<b>Could not remove that product</b> — " + esc(errText(err)), true);
    });
  });

  /* ================= the printable sheet ================= */
  function buildSheet(){
    var s = current();
    var rows = "";
    for(var i=0;i<s.rows.length;i++){
      var r = s.rows[i];
      rows += "<tr>" +
        "<td class=\"n\">" + (i+1) + "</td>" +
        "<td>" + (r.name ? esc(r.name) : "<i>sans nom</i>") +
          (r.nameAr ? ' <span class="ar">' + esc(r.nameAr) + "</span>" : "") + "</td>" +
        "<td class=\"mono\">" + esc(r.code) + "</td>" +
        "<td class=\"mono\">" + esc(r.sku || "—") + "</td>" +
        "<td class=\"n\">" + r.qty + "</td>" +
        "<td class=\"n mono\">" + (r.unit == null ? "—" : money(r.unit)) + "</td>" +
        "<td class=\"n mono\">" + (r.line == null ? "—" : money(r.line)) + "</td>" +
      "</tr>";
    }
    if(!rows) rows = '<tr><td colspan="7" class="none">Aucun article sur la liste.</td></tr>';

    $("sheet").innerHTML =
      '<div class="sheet-head">' +
        '<div>' +
          '<h1>' + esc(docTitle()) + '</h1>' +
          '<p>Pyjama Dz · ' + esc(PDZ.stamp()) + '</p>' +
        '</div>' +
        '<div class="sheet-tot">' +
          '<b>' + (s.priced ? "" : "≥") + money(s.total) + ' DA</b>' +
          '<span>' + s.pieces + ' pièces · ' + s.products + ' produits</span>' +
        '</div>' +
      '</div>' +
      '<table class="sheet-table">' +
        '<thead><tr>' +
          '<th class="n">#</th><th>Produit</th><th>Code-barres</th><th>Référence</th>' +
          '<th class="n">Qté</th><th class="n">P.U. DA</th><th class="n">Total DA</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr>' +
          '<td colspan="4">Total</td>' +
          '<td class="n">' + s.pieces + '</td>' +
          '<td class="n"></td>' +
          '<td class="n mono">' + (s.priced ? "" : "≥") + money(s.total) + '</td>' +
        '</tr></tfoot>' +
      '</table>' +
      (s.priced ? "" : '<p class="sheet-note">≥ : un ou plusieurs articles n\'ont pas encore de prix.</p>');
  }

  $("btnPrint").addEventListener("click", function(){
    if(!scans.length){ say("<b>Nothing to print.</b> Scan something first.", true); return; }
    buildSheet();
    // let the sheet land in the DOM before the dialog freezes rendering
    setTimeout(function(){
      try{ window.print(); }
      catch(e){ say("<b>The print dialog could not open.</b> Use Export PDF instead.", true); }
    }, 60);
  });

  /* ================= PDF ================= */
  function pdfLib(){
    if(window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if(window.jsPDF) return window.jsPDF;
    return null;
  }

  $("btnPdf").addEventListener("click", function(){
    var s = current();
    if(!s.rows.length){ say("<b>Nothing to export.</b> Scan something first.", true); return; }

    var JsPDF = pdfLib();
    if(!JsPDF){
      say("<b>The PDF library did not load.</b> Use <em>Imprimer</em> and choose \"Save as PDF\".", true);
      return;
    }

    try{
      var doc = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      var L = 14, R = 196, y = 20;
      var COLS = [L, L+8, L+62, L+96, L+122, L+140, L+164];   // #, produit, code, ref, qté, PU, total

      function header(){
        doc.setFont("helvetica", "bold"); doc.setFontSize(15);
        doc.text(docTitle(), L, y);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9);
        doc.setTextColor(110);
        doc.text("Pyjama Dz  ·  " + PDZ.stamp(), L, y + 5.5);
        doc.setTextColor(20);

        doc.setFont("helvetica", "bold"); doc.setFontSize(12);
        doc.text((s.priced ? "" : ">= ") + money(s.total) + " DA", R, y, { align: "right" });
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
        doc.setTextColor(110);
        doc.text(s.pieces + " pieces  ·  " + s.products + " produits", R, y + 5, { align: "right" });
        doc.setTextColor(20);

        y += 12;
        doc.setDrawColor(30); doc.setLineWidth(0.4);
        doc.line(L, y, R, y);
        y += 6;

        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
        doc.text("#",         COLS[0], y);
        doc.text("PRODUIT",   COLS[1], y);
        doc.text("CODE",      COLS[2], y);
        doc.text("REF",       COLS[3], y);
        doc.text("QTE",       COLS[4] + 12, y, { align: "right" });
        doc.text("P.U. DA",   COLS[5] + 18, y, { align: "right" });
        doc.text("TOTAL DA",  R,       y, { align: "right" });
        y += 2.5;
        doc.setLineWidth(0.2); doc.setDrawColor(160);
        doc.line(L, y, R, y);
        y += 5;
        doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      }

      function footer(){
        var page = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8); doc.setTextColor(140);
        doc.text("Page " + page, R, 288, { align: "right" });
        doc.setTextColor(20);
      }

      header();

      for(var i = 0; i < s.rows.length; i++){
        if(y > 272){ footer(); doc.addPage(); y = 20; header(); }
        var r = s.rows[i];

        // jsPDF's standard fonts are Latin-only, so anything outside
        // that range is dropped rather than drawn as tofu.
        var name = String(r.name || "sans nom").replace(/[^\x20-\x7EÀ-ɏ]/g, "").trim() || "sans nom";
        name = doc.splitTextToSize(name, 52)[0];

        doc.text(String(i + 1),                COLS[0], y);
        doc.text(name,                          COLS[1], y);
        doc.text(String(r.code),                COLS[2], y);
        doc.text(String(r.sku || "-").slice(0, 16), COLS[3], y);
        doc.text(String(r.qty),                 COLS[4] + 12, y, { align: "right" });
        doc.text(r.unit == null ? "-" : money(r.unit), COLS[5] + 18, y, { align: "right" });
        doc.text(r.line == null ? "-" : money(r.line), R,  y, { align: "right" });
        y += 6;

        if(i < s.rows.length - 1){
          doc.setDrawColor(226); doc.setLineWidth(0.1);
          doc.line(L, y - 4, R, y - 4);
        }
      }

      y += 2;
      doc.setDrawColor(30); doc.setLineWidth(0.4);
      doc.line(L, y, R, y);
      y += 6;
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text("TOTAL", COLS[1], y);
      doc.text(String(s.pieces) + " pcs", COLS[4] + 12, y, { align: "right" });
      doc.text((s.priced ? "" : ">= ") + money(s.total) + " DA", R, y, { align: "right" });

      if(!s.priced){
        y += 6;
        doc.setFont("helvetica", "normal"); doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(">=  un ou plusieurs articles n'ont pas encore de prix.", L, y);
      }

      footer();

      var name2 = docTitle().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase();
      doc.save((name2 || "liste") + "-" + new Date().toISOString().slice(0,10) + ".pdf");
      say("<b>PDF saved.</b> Arabic names are not in it — use <em>Imprimer</em> if you need them.");
    }catch(e){
      say("<b>PDF export failed</b> — " + esc(errText(e)) + ". Try <em>Imprimer</em>.", true);
    }
  });

  /* ================= CSV ================= */
  $("btnCopy").addEventListener("click", function(){
    var s = current();
    if(!s.rows.length){ say("<b>Nothing to copy.</b> Scan something first.", true); return; }
    var text = PDZ.csv(s.rows);
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){
        say("<b>Copied.</b> " + s.products + " product line" + (s.products===1?"":"s") + " on the clipboard.");
      }, function(){ showBox(text); });
    } else showBox(text);
  });
  function showBox(text){
    $("copyPanel").hidden = false;
    $("copyBox").value = text;
    $("copyBox").focus(); $("copyBox").select();
    say("<b>Select the text below</b> and copy it.");
  }

  /* ================= clear ================= */
  var clearArmed = false, clearTimer = null;
  $("btnClear").addEventListener("click", function(){
    if(!scans.length) return;
    if(!clearArmed){
      clearArmed = true;
      $("btnClear").textContent = "Really clear?";
      clearTimer = setTimeout(function(){
        clearArmed = false; $("btnClear").textContent = "Clear list";
      }, 4000);
      say("<b>This empties the list" + (mode === "cloud" ? " for everyone" : "") +
          ".</b> Tap again to confirm — saved products are kept.");
      return;
    }
    clearTimeout(clearTimer); clearArmed = false; $("btnClear").textContent = "Clear list";
    store.clearScans(scans.map(function(x){ return x.id; })).then(function(){
      say("<b>List cleared.</b> The catalog is untouched.");
    }).catch(function(err){
      say("<b>Some lines could not be removed</b> — " + esc(errText(err)), true);
    });
  });

  /* ================= title, remembered per device ================= */
  try{
    var saved = localStorage.getItem(TITLE_KEY);
    if(saved) $("docTitle").value = saved;
  }catch(e){}
  $("docTitle").addEventListener("input", function(){
    try{ localStorage.setItem(TITLE_KEY, $("docTitle").value); }catch(e){}
  });

  /* ================= start ================= */
  render();

  Store.open().then(function(res){
    store = res.store;
    setSync(store.mode, store.label);
    store.onCatalog(function(c){ catalog = c; render(); });
    store.onScans(function(s){ scans = s; render(); });

    $("footNote").textContent = (store.mode === "cloud")
      ? "Shared database — every phone sees the same list."
      : "This browser only. Add Supabase keys in config.js to share across phones.";

    say(res.fellBack
      ? "<b>Supabase unreachable</b> — " + esc(res.reason) + " Showing this device's list."
      : "<b>Ready.</b> Imprimer gives a clean sheet; every print dialog can save it as PDF.");
  }).catch(function(err){
    say("<b>Storage failed to start</b> — " + esc(errText(err)), true);
  });

})();
