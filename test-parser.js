/* ============================================================
   test-parser.js — run with:  node test-parser.js
   ------------------------------------------------------------
   The SmartLabelParser is a pure function, so it is tested on its
   own, with no DOM and no camera. Covers the three real label
   layouts plus the traps: barcode digits, care text, prose, and
   prices that must never be read as a product code.
   ============================================================ */

const path = require("path");
const g = globalThis;
require(path.join(__dirname, "label-parser.js"));
const { parse } = g.LabelParser;

let failures = 0;
function check(name, got, want){
  const keys = Object.keys(want);
  const bad = keys.filter(k => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
  if(bad.length === 0){
    console.log("  PASS  " + name);
    return;
  }
  failures++;
  console.log("  FAIL  " + name);
  bad.forEach(k => console.log("          " + k + ": got " + JSON.stringify(got[k]) +
                              "   want " + JSON.stringify(want[k])));
}

/* A label as OCR returns it, with rough boxes. The barcode box is the
   anchor; y grows downward, all values 0..1 of the cropped region. */
function L(text, x, y, w, h, conf){
  return { text, box: { x, y, w, h }, conf: conf == null ? 88 : conf };
}

console.log("\nSmartLabelParser\n");

/* ---------- TYPE A: explicit Arabic field labels ---------- */
check("TYPE A — labelled fields", parse({
  barcode: "445853470123",
  barcodeBox: { x: 0.10, y: 0.55, w: 0.80, h: 0.14 },
  lines: [
    L("اسم المنتج",    0.30, 0.05, 0.40, 0.06),
    L("Robe / روب",    0.32, 0.13, 0.36, 0.07),
    L("رمز المنتج",    0.30, 0.28, 0.40, 0.06),
    L("BASKAT Z8-1",   0.28, 0.36, 0.44, 0.07),
    L("445853470123",  0.20, 0.71, 0.60, 0.05),
    L("1600 DA",       0.34, 0.84, 0.32, 0.09)
  ]
}), {
  barcode: "445853470123",
  productCode: "BASKAT Z8-1",
  productName: "Robe",
  price: 1600
});

/* ---------- TYPE B: no field labels, short numeric ref ---------- */
check("TYPE B — bare numeric reference", parse({
  barcode: "6111245987453",
  barcodeBox: { x: 0.12, y: 0.10, w: 0.76, h: 0.18 },
  lines: [
    L("6111245987453", 0.22, 0.30, 0.56, 0.05),
    L("7630",          0.40, 0.40, 0.20, 0.08),
    L("1800 DA",       0.34, 0.55, 0.32, 0.10),
    L("HEAT",          0.36, 0.72, 0.28, 0.08),
    L("UNDERWEAR",     0.26, 0.81, 0.48, 0.08)
  ]
}), {
  productCode: "7630",
  productName: "HEAT UNDERWEAR",     // OCR split it across two lines
  price: 1800
});

/* HEAT / UNDERWEAR arrive as two OCR lines; as one line it must be the name */
check("TYPE B — two-word product name", parse({
  barcode: "6111245987453",
  barcodeBox: { x: 0.12, y: 0.10, w: 0.76, h: 0.18 },
  lines: [
    L("7630",           0.40, 0.40, 0.20, 0.08),
    L("1800 DA",        0.34, 0.55, 0.32, 0.10),
    L("HEAT UNDERWEAR", 0.26, 0.75, 0.48, 0.08)
  ]
}), {
  productCode: "7630",
  productName: "HEAT UNDERWEAR",
  price: 1800
});

/* ---------- TYPE C: word + number reference, no name ---------- */
check("TYPE C — 'pull 699'", parse({
  barcode: "6130987112345",
  barcodeBox: { x: 0.12, y: 0.12, w: 0.76, h: 0.18 },
  lines: [
    L("pull 699", 0.32, 0.42, 0.36, 0.09),
    L("2300 DA",  0.34, 0.62, 0.32, 0.10)
  ]
}), {
  productCode: "pull 699",
  price: 2300
});

/* ---------- traps ---------- */

check("a price is never the product code", parse({
  barcode: "1044797380876",
  lines: [L("1950 DA", 0.3, 0.5, 0.3, 0.1)]
}), { productCode: null, price: 1950 });

check("the printed barcode digits are never the product code", parse({
  barcode: "1044797380876",
  lines: [
    L("1044797380876", 0.2, 0.4, 0.6, 0.05),
    L("PULL AR-195",   0.3, 0.5, 0.4, 0.07),
    L("1950 DA",       0.35, 0.62, 0.3, 0.09)
  ]
}), { productCode: "PULL AR-195", price: 1950 });

check("care and composition text is ignored", parse({
  barcode: "4458534760123",
  lines: [
    L("80% POLYESTER 20% COTON", 0.1, 0.2, 0.8, 0.05),
    L("MADE IN ALGERIA",         0.2, 0.28, 0.6, 0.05),
    L("تعليمات العناية",          0.3, 0.36, 0.4, 0.05),
    L("BASKAT Z8-1",             0.3, 0.5, 0.4, 0.07),
    L("1600 DA",                 0.35, 0.65, 0.3, 0.09)
  ]
}), { productCode: "BASKAT Z8-1", price: 1600 });

check("marketing prose never becomes the product name", parse({
  barcode: "4458534760123",
  lines: [
    L("Our Collection Has Been Designed For Comfort", 0.05, 0.2, 0.9, 0.05),
    L("Robe",     0.4, 0.4, 0.2, 0.08),
    L("BASKAT Z8-1", 0.3, 0.52, 0.4, 0.07),
    L("1600 DA",  0.35, 0.68, 0.3, 0.09)
  ]
}), { productCode: "BASKAT Z8-1", productName: "Robe", price: 1600 });

check("the brand block never becomes the product name", parse({
  barcode: "1044797380876",
  barcodeBox: { x: 0.10, y: 0.20, w: 0.80, h: 0.14 },
  lines: [
    L("1044797380876", 0.20, 0.36, 0.60, 0.05),
    L("PULL AR-195",   0.30, 0.46, 0.40, 0.07),
    L("1950 DA",       0.35, 0.60, 0.30, 0.09),
    L("PYJAMA DZ",     0.30, 0.78, 0.40, 0.06),
    L("FASHION",       0.34, 0.86, 0.32, 0.05)
  ]
}), { productCode: "PULL AR-195", productName: null, price: 1950, brand: "PYJAMA DZ" });

check("French 'Réf:' label wins", parse({
  barcode: "6111245987453",
  lines: [
    L("Réf: AB-2290", 0.2, 0.3, 0.6, 0.07),
    L("MODEL-123",    0.25, 0.45, 0.5, 0.07),
    L("1200 DA",      0.35, 0.6, 0.3, 0.09)
  ]
}), { productCode: "AB-2290", price: 1200 });

check("price formats: DZD and دج", parse({
  barcode: null, lines: [L("1800 DZD", 0, 0, 1, 0.1)]
}).price, 1800);
check("price format دج", parse({
  barcode: null, lines: [L("2300 دج", 0, 0, 1, 0.1)]
}).price, 2300);

check("nothing readable -> nulls, low confidence", parse({
  barcode: "4458534760123", lines: []
}), { productCode: null, productName: null, price: null });

/* ---------- confidence behaviour ---------- */
const labelled = parse({
  barcode: "445853470123",
  lines: [
    L("رمز المنتج",  0.3, 0.2, 0.4, 0.05),
    L("BASKAT Z8-1", 0.3, 0.28, 0.4, 0.07),
    L("1600 DA",     0.35, 0.5, 0.3, 0.09)
  ]
});
const scraped = parse({
  barcode: "6130987112345",
  lines: [L("pull 699", 0.3, 0.4, 0.4, 0.08)]
});
if(labelled.confidence > scraped.confidence){
  console.log("  PASS  an explicit field label scores higher than a scraped guess" +
              "  (" + labelled.confidence + " vs " + scraped.confidence + ")");
} else {
  failures++;
  console.log("  FAIL  confidence ordering: labelled " + labelled.confidence +
              " should beat scraped " + scraped.confidence);
}

console.log("\n" + (failures ? failures + " FAILURE(S)\n" : "All parser checks passed\n"));
process.exit(failures ? 1 : 0);
