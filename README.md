# Pyjama Dz Tag Scanner

An intelligent camera & barcode scanner for clothing tags. Scans the complete barcode (code-barres),
the reference/SKU, the brand name (marque), and the price directly from the label in one smart sweep.
Built around clothing tags like `4458534760123` (Pyjama Dz · Robe / روب, BASKAT Z8-1, 1600 DA).

---

## Files

## Two pages, one database

| Page | What it is for |
|---|---|
| **`index.html`** | **The scanner.** Camera, reading tags, naming a new product. Shows the last five scans so you can see it working, and a link to the list. |
| **`database.html`** | **The database.** Full list with quantities, product catalog, totals, **Imprimer**, **Export PDF**, Copy CSV, Clear. |

Both read and write the same store, so a scan on one phone shows up on the
other page immediately. Keep the scanner open on the shop phone and the
database open on a laptop — they stay in step.

| File | What it is |
|---|---|
| `styles.css` | All styling, light and dark, plus the print layout. |
| `config.js` | **The only file you normally edit.** Supabase URL and key. |
| `common.js` | Shared helpers — grouping, totals, check digits, barcode drawing. |
| `decoder.js` | The fast decode engine — cropping, scaling, format strategy. |
| `ocr.js` | Intelligent OCR: reads brand name, reference/SKU, garment name, price and barcode digits. |
| `store.js` | Storage. Supabase when configured, browser storage otherwise. |
| `scanner.js` | The scanner page. |
| `database.js` | The database page, printing and PDF. |
| `schema.sql` | The Supabase tables, policies and realtime setup. |
| `selftest.js` | Runs both pages against a stubbed DOM. |

---

## Getting it on paper

Two buttons on **database.html**, and they are not the same thing.

### Imprimer

Builds a clean A4 document — title, date, numbered table of Produit / Code-barres /
Référence / Qté / P.U. / Total, a totals row — and opens the print dialog. The app's
own interface is stripped out by the print stylesheet; only the sheet prints.

**The browser renders it, so Arabic names come out correctly.** And every print
dialog, on a phone too, offers **Save as PDF** — so this is also the best way to get
a PDF with Arabic in it.

The document title is a field on the page (default *Liste d'inventaire*), remembered
per device.

### Export PDF

Writes a real `.pdf` straight to your downloads with jsPDF — no dialog, one tap.

**It leaves Arabic out.** jsPDF's built-in fonts are Latin-only and it does no
right-to-left shaping, so the Arabic name would come out as blank boxes or reversed
letters. Rather than print garbage, the export carries the Latin name, the barcode,
the SKU, quantities and prices, and drops the Arabic column. The button says so after
each export.

**So: Export PDF for a quick file. Imprimer for anything that has to show Arabic.**

---

## Before you deploy a change

```powershell
node selftest.js scanner
node selftest.js database
node selftest.js database seeded
node selftest.js decoder
node selftest.js ocr
```

Each loads that page's scripts into a fake DOM and drives the real paths — photo
scan, manual entry, saving a product, camera without permission, grouping,
quantities, and the print sheet actually being built with the right rows in it.

`node --check` only finds syntax errors. This catches a `ReferenceError` inside a
callback, which is the kind of bug that otherwise only shows up on the phone as a
screen stuck mid-action.

Two libraries load from a CDN: `@zxing/library` (barcode decoding) and
`@supabase/supabase-js`. The page needs an internet connection for those.

---

## Running it

The camera only works in a **secure context** — that means HTTPS, or `localhost`.
Opening `index.html` by double-clicking it (a `file://` URL) will show the page but
**the camera will not start**. This is a browser rule, not a bug in the scanner.

### On your computer, to try it

```powershell
cd C:\Users\USER\pyjama-dz-scanner
python -m http.server 8000
```

Open <http://localhost:8000> for the scanner, or
<http://localhost:8000/database.html> for the list. The camera works here because
`localhost` counts as secure.

### On your phone — the part that matters

Your phone reaching your PC over the local network (`http://192.168.x.x:8000`) is
**not** a secure context, so the camera will refuse. You need real HTTPS hosting.
Any of these work, take a few minutes, and are free:

- **Netlify Drop** — <https://app.netlify.com/drop>, drag the folder in, done.
- **Vercel** — `npx vercel` in this folder.
- **GitHub Pages** — push the folder to a repo, enable Pages in settings.
- **Cloudflare Pages** — connect a repo or upload directly.

There is no build step. It is plain HTML, CSS and JS — upload the folder as it is.

> Until you set up hosting, **Scan a photo** works everywhere, including `file://`.
> It opens the phone camera as a normal picture, then decodes the photo.

---

## Storage

### Without Supabase (works immediately)

Leave `config.js` empty. Everything saves to that browser's storage. The scanner is
fully usable, but each phone has its own separate list, and clearing browser data
erases it.

### With Supabase (shared across phones)

1. Open your Supabase project → **SQL Editor** → paste all of `schema.sql` → **Run**.
   This creates `products` and `scans`, sets the access policies, turns on realtime,
   and inserts the one tag already known.

2. Get your credentials: **Project Settings → Data API** for the Project URL, and
   **Project Settings → API Keys** for the `anon` / public key.

3. Put them in `config.js`:

   ```js
   window.PYJAMADZ_CONFIG = {
     supabaseUrl: "https://YOURPROJECT.supabase.co",
     supabaseAnonKey: "eyJhbGciOi...",
     scanWindow: 500
   };
   ```

4. Reload. The chip in the top right turns green and says **supabase**. Open the page
   on a second phone and both lists update live.

If anything you saved before is still on the device, a bar appears offering to upload
it into Supabase in one tap.

#### About the anon key

The anon key is visible to anyone who opens the page — that is normal for Supabase
browser apps, and the policies in `schema.sql` deliberately allow it to read and write.
**So anyone with the page URL and that key can read and change your products and scans.**

For a page you keep to your own phones, that is a reasonable trade. If it ever needs to
be public, turn on Supabase Auth and change the four policies in `schema.sql` from
`to anon` to `to authenticated`, then add a login screen.

---

## How it works

**Decoding.** Uses the phone's built-in `BarcodeDetector` when available (fast, on
Android Chrome) and falls back to ZXing everywhere else, including iOS Safari. Formats:
EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, ITF, Codabar.

### A barcode is only a number

This trips everyone up once. `1044797380876` is the *entire* contents of that tag's
barcode — 13 digits and nothing else. "PULL AR-195" and "1950 DA" are ink printed
beside the bars; they are not encoded in them, and no scanner on earth gets them out
of the bars.

So a code the catalog has never seen shows as **Unknown item**. That is correct
behaviour, not a failure: the scan worked, but nothing has yet said what that number
means. Naming it once writes `products/<code>` and every future scan — on any phone —
comes back named and priced.

**Reading the tag automatically.** Because the name and price *are* on the label, the
scanner points OCR at the same picture. When an unknown code is scanned it captures the
frame, reads the printed text and fills in name, reference and price for you. There is
also a **Read the tag** button to run it again or after a photo scan.

Suggested values are shown in an **amber-tinted field** and are never saved on their
own — you check them and press Save. OCR misreads small print, and a wrong price saved
silently is worse than an empty one. It also cross-checks the digits it reads under the
bars against the code the scanner decoded, and warns you if they disagree.

Tesseract is ~4 MB, so it loads only the first time an unknown code actually needs it,
never on page load.

### What it can and cannot read

Worth knowing before you try to tune it further, because two of the obvious wishes
are walls rather than bugs.

**Distance is set by pixels, not by cleverness.** A barcode is decodable only if its
narrowest bar lands on at least ~2 camera pixels, comfortably 3. EAN-13 is 95 modules
wide, so the barcode has to span roughly 250–300 pixels *in the captured frame*. Past
that distance the detail is not faint — it is not in the image at all, and no algorithm
puts it back. The only real levers are optical, and both are used: capture at the
highest resolution the camera offers, and use the camera's own zoom to spend those
pixels on a smaller patch of the world. Hence the **zoom buttons on the viewfinder**
(1× / 2× / 3× / max).

**Zoom is manual on purpose.** The engine never changes it by itself. An earlier
version zoomed automatically when nothing read for a couple of seconds; it was removed
because a viewfinder that moves while you are lining up a tag is worse than a short
reach. `node selftest.js decoder` has a test that fails if anything ever zooms without
a button press.

**A partly covered 1D barcode is unrecoverable.** EAN-13, Code 39 and ITF carry *no*
error correction. The check digit detects a misread; it cannot rebuild missing bars.
Cover part of the bar region and the number is mathematically gone. (QR and DataMatrix
use Reed-Solomon and survive ~30% loss — 1D retail codes do not.) If tags genuinely
need to read while partly obscured, that is a decision about *what you print on the
tag*, not about this code.

What the engine *can* do is find a tag that is small, off-centre, tilted, upside down
or at the edge of the picture — which is usually what "hidden" turns out to mean.

**Why it reads fast** — all of this is in `decoder.js`, and every line of it is about
doing *less work per frame* rather than scanning more often:

- **It crops.** A tag held up to the camera sits in the middle of the picture, so only a
  centred band is decoded. About 6× fewer pixels than the full frame.
- **It downscales.** A barcode needs roughly 3 pixels per bar to read. Beyond that,
  resolution is pure cost, so the crop is drawn into a canvas capped at 720px wide.
  The camera is still *asked* for 1920×1080, because cropping a sharp source beats
  cropping a soft one — the shrink happens after.
- **It enables fewer formats.** Each symbology is another decode pass. It starts on
  retail codes only (EAN/UPC — what a clothing tag carries) and widens to all eight
  automatically after 3.5 seconds of finding nothing.
- **`TRY_HARDER` is off for video.** It makes one frame slower in exchange for reading
  awkward images. On live video the next frame is 30 ms away, so more frames beats more
  effort per frame. Still photos get it turned back on, since there is no next frame.
- **It talks to ZXing at the low level** — `MultiFormatReader` over a canvas luminance
  source — instead of `decodeFromStream`, which captures its own full-resolution frame
  and rebuilds its objects on every pass.
- **It runs on `requestVideoFrameCallback`**, so it decodes each presented frame exactly
  once and never queues work behind a frame that has not arrived.

**The scan plan.** Rather than one crop, the engine keeps a list of 14 windows onto the
frame and works through them:

| Window | What it catches |
|---|---|
| Centre band, 0° and 90° | A tag held up to the camera — the common case, tried first |
| Whole frame, 0° and 90° | A tag anywhere, if it is large enough |
| Four overlapping quadrants at ~2×, each 0° and 90° | A small tag off to one side |
| Centre close-up at ~3×, 0° and 90° | A distant tag |
| ±28° tilted band | A tag lying at an angle |

Each frame works through the plan under a ~30 ms budget and **resumes next frame where
it ran out**, so coverage is wide without the frame rate collapsing. The window that
last succeeded is tried first next time, so once it locks on, it stays fast.

**And it adapts.** When it is dark it turns the torch on by itself. After
3.5 s it enables every barcode format. When scanning stalls it measures the picture and
says what is wrong: *too dark*, *glare on the tag*, *bars look blurred — the tag may be
too far to resolve*. Tapping the viewfinder forces a refocus, which fixes the most common
failure of all: the lens settled on the background instead of the tag.

**It refuses bad reads.** A code whose check digit adds up is accepted instantly.
Anything else has to come back identical twice before it counts, so a half-seen tag
cannot put a wrong number on your list.

**Check digits.** EAN-13/EAN-8/UPC-A codes are verified and the ticket shows *checksum
valid* or *checksum fails*, which catches a misread or a badly printed label. The same
maths generates the barcode picture drawn under each code.

**The list groups by barcode.** One line per product with a `×N` quantity, not one line
per scan. Under the hood every scan is still its own row in `scans` — the grouping
happens when drawing. That is deliberate: a shared counter column would let two phones
scanning at once overwrite each other, while separate rows cannot be lost.

**Naming.** An unknown barcode appears as "Not named yet" with a **Name it** button.
Fill in name, SKU, Arabic name and price once, and every line for that barcode — past
and future — shows it, because the list reads names from `products` at draw time.

**Duplicate guard.** The same code within 2.5 seconds counts once, so holding the
camera on a tag does not run the number up.

---

## Things to know

- **`scanWindow`** in `config.js` caps how many recent scans are loaded (default 500).
  Older scans stay in the database; they are just not drawn.
- **Copy CSV** puts the grouped list on the clipboard:
  `name, code, sku, qty, unit_price_da, line_total_da, last_scanned`.
- **Clear list** deletes scans, never products. It asks twice.
- **`≥` before the total** means something on the list has no price yet, so the total
  is a floor, not the real figure.
- **Torch** appears only if the camera reports torch support — mostly Android.

---

## Same thing as a hosted artifact

There is a published version at <https://claude.ai/artifact/RrNCQbFtWVaw7qzPdnoePs>
that needs no hosting and no Supabase — it uses the artifact platform's own database.
The code here is the standalone equivalent. The two do **not** share data: the artifact
cannot reach Supabase (its sandbox blocks outbound requests), and this version cannot
reach the artifact's database. Pick one as the real one.
