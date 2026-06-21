# Invoice PDF Generator

Configurable HTML → PDF invoice generator. Set your logo and company details once
in a config file, then generate branded invoice PDFs from order data. Rendering is
done with headless Chrome (Puppeteer), so the PDF looks exactly like the HTML.

## Install

```bash
npm install
```

This downloads a headless Chrome build for Puppeteer (~one-time, a few hundred MB).

## Quick start

```bash
npm run demo
# → writes output/invoice.pdf from config/company.json + data/sample-invoice.json
```

Or with the CLI directly:

```bash
node src/cli.js --data data/sample-invoice.json --out output/PURQK.pdf
```

## Configure your brand

Edit `config/company.json`:

```json
{
  "brand": {
    "name": "YOUR COMPANY PVT LTD",
    "logo": "assets/logo.svg",   // svg/png/jpg path (relative to project root), or a data:/https: URL
    "logoWidth": 240
  },
  "address": {
    "lines": ["Street", "City 000000", "State, Country"],
    "phone": "+91 ...",
    "email": "contact@yourco.com"
  },
  "invoice": {
    "currency": "₹",
    "locale": "en-IN",
    "accentColor": "#000000",    // header bar / table accent
    "footerNote": ""
  },
  "tax": {
    "gstin": "33XXXXXXXXXXXXX",  // your GSTIN (shown on invoice)
    "pan": "AABCN1234A",         // optional
    "rate": 5,                   // GST % — used to derive tax from inclusive prices
    "supplyType": "intra",       // "intra" → CGST+SGST, "inter" → IGST
    "priceInclusive": true       // line-item prices already include tax
  }
}
```

The logo is embedded into the PDF as a data URI, so the output is self-contained.

## Invoice data

Each invoice is a JSON file (see `data/sample-invoice.json`):

```json
{
  "invoiceNumber": "c2050296817567924224",
  "orderNumber": "PURQK",
  "orderDate": "May 2, 2026",
  "paymentMethod": "Airpay",
  "billTo": {
    "name": "Ravi Dhakad",
    "lines": ["Flat 102, Bldg A-3", "Dombivli East 421201", "Maharashtra"],
    "email": "buyer@example.com",
    "phone": "7354868619"
  },
  "items": [
    { "product": "Sky Blue Plain T-Shirt", "quantity": 1, "price": 100.0 }
  ],
  "tax": 4.76
}
```

- `subtotal` is computed from `items` (quantity × price) unless you set it explicitly.
- `total` defaults to `subtotal` unless set explicitly.
- Line-item `price` values are treated as **tax-inclusive** when `tax.priceInclusive` is true in config.
- `tax` on the invoice is optional — if omitted, it is derived from the configured GST rate:
  `tax = total × rate / (100 + rate)` (e.g. ₹100 @ 5% GST → ₹4.76 tax, ₹95.24 taxable value).
- The invoice shows **Taxable Value**, **CGST/SGST** (intra-state) or **IGST** (inter-state), and a note that prices include tax.
- Set `tax.gstin` and optionally `tax.pan` in `config/company.json` to print your registration on every invoice.

## Batch mode — one PDF per order

Give it a **list of invoices** and a **logo path**, and it writes one PDF per order,
named by order number, into an output directory. A single browser is reused, so it's
fast for large batches.

```bash
npm run demo:batch
# → output/batch/PURQK.pdf, output/batch/ZX91A.pdf, output/batch/MN77C.pdf
```

Direct CLI:

```bash
node src/batch.js --data data/sample-batch.json --logo assets/logo.svg --out output/batch
```

Input (`--data`) can be either:
- a **JSON file containing an array** of invoice objects (see `data/sample-batch.json`),
  or `{ "invoices": [ ... ] }`, or
- a **directory** of per-invoice `.json` files (each processed in filename order).

Batch CLI options:

```
-d, --data   <path>   Array-JSON file OR a directory of .json files (required)
-l, --logo   <path>   Logo path/URL applied to every invoice (overrides config)
-c, --config <file>   Company/branding config (default: config/company.json)
-o, --out    <dir>    Output directory for the PDFs (default: output)
```

File naming: `<orderNumber>.pdf`. Unsafe characters are sanitized; if `orderNumber`
is missing it falls back to `invoiceNumber`, then `invoice-N`. Duplicate order
numbers get a `-2`, `-3` suffix so nothing is overwritten.

As a library:

```js
const { generatePDFsBatch } = require("./src/index");

const results = await generatePDFsBatch({
  config,                 // company config object
  invoices,               // array of invoice data objects
  baseDir: __dirname,     // resolves a relative logo path
  outDir: "output/batch",
  logo: "assets/logo.svg",// optional, overrides config.brand.logo for all
  onProgress: (r) => console.log(r.ok ? `✓ ${r.file}` : `✗ ${r.error}`),
});
// → [{ file, orderNumber, ok, error }, ...]
```

## CSV mode — one PDF per row

Generate one PDF per CSV row, named by a chosen column (default `C Number`):

```bash
node src/csv-batch.js --csv orders.csv --name "C Number" --logo logo.png --out output/csv
```

Default column mapping (Airpay export):

| CSV column          | Invoice field                  |
|---------------------|--------------------------------|
| `C Number`          | file name + Invoice Number     |
| `Airpay ID`         | Order Number                   |
| `Txn Date`          | Order Date                     |
| `Pay Channel`       | Payment Method                 |
| `RRN`               | extra "RRN" detail             |
| `Txn Amount`        | line-item price (qty 1)        |
| `Cust Name`         | Bill-to name                   |
| `Cust Address`      | Bill-to address (split on commas) |
| `Cust Gmail`        | Bill-to email                  |
| `Cust Phone Number` | Bill-to phone                  |

Options: `--csv <file>` (required), `-n/--name <col>` (naming column),
`-l/--logo <path>`, `-o/--out <dir>`, `-c/--config <file>`,
`-p/--product <label>` (line-item label, default "Online Purchase").
If `--logo` is omitted and `logo.png` exists at the project root, it is used automatically.
The parser handles quoted fields, embedded commas, and escaped quotes.

To map a different CSV, edit `DEFAULT_COLS` at the top of `src/csv-batch.js`.

## CLI options

```
-c, --config <file>   Company/branding config (default: config/company.json)
-d, --data   <file>   Invoice data JSON (required)
-o, --out    <file>   Output PDF path (default: output/invoice.pdf)
    --html            Also write the rendered HTML next to the PDF (handy for previewing)
-h, --help            Show help
```

## Use as a library

```js
const { generatePDF, generateHTML } = require("./src/index");

const pdf = await generatePDF({ config, data, baseDir, outPath: "out.pdf" }); // Buffer
const html = generateHTML({ config, data, baseDir });                        // string
```

## Test

```bash
npm test
```

Runs HTML-rendering assertions (content, currency, tax, HTML-escaping, subtotal math)
and verifies a valid, non-empty PDF is produced.

## Project layout

```
config/company.json      branding + company details (edit me)
assets/logo.svg          default logo (replace with yours)
data/sample-invoice.json example single-invoice data
data/sample-batch.json   example list of invoices (batch mode)
src/template.js          HTML template + formatting helpers
src/index.js             generateHTML / generatePDF / generatePDFsBatch API
src/cli.js               single-invoice command-line entry point
src/batch.js             batch command-line entry point
test/test.js             tests
output/                  generated PDFs (gitignored)
```
