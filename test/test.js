"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { generateHTML, generatePDF, generatePDFsBatch, fileNameFor } = require("../src/index");
const { parseCSV } = require("../src/csv");

const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "config/company.json"), "utf8"));
const data = JSON.parse(fs.readFileSync(path.join(root, "data/sample-invoice.json"), "utf8"));
const baseDir = root;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

async function run() {
  console.log("HTML rendering:");
  const html = generateHTML({ config, data, baseDir });

  check("produces a complete HTML document", () => {
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.includes("</html>"));
  });
  check("includes company name", () => {
    assert.ok(html.includes(config.brand.name));
  });
  check("embeds the logo as a data URI", () => {
    assert.ok(html.includes("data:image/svg+xml;base64,"));
  });
  check("renders the line item and price", () => {
    assert.ok(html.includes("Sky Blue Plain T-Shirt"));
    assert.ok(html.includes("₹100.00"));
  });
  check("computes subtotal from items", () => {
    assert.ok(html.includes("Amount (Incl. Tax)"));
    assert.ok(html.includes("₹100.00"));
  });
  check("shows tax breakdown for inclusive pricing", () => {
    assert.ok(html.includes("Taxable Value"));
    assert.ok(html.includes("CGST @ 2.5%"));
    assert.ok(html.includes("SGST @ 2.5%"));
    assert.ok(html.includes("₹95.24"));
    assert.ok(html.includes("All prices are inclusive of applicable taxes."));
  });
  check("shows GSTIN when configured", () => {
    const withGst = generateHTML({
      config: { ...config, tax: { ...config.tax, gstin: "33AABCN1234A1Z5" } },
      data,
      baseDir,
    });
    assert.ok(withGst.includes("GSTIN:"));
    assert.ok(withGst.includes("33AABCN1234A1Z5"));
  });
  check("escapes HTML in user data", () => {
    const evil = generateHTML({
      config,
      data: { ...data, billTo: { name: "<script>x</script>" }, items: [] },
      baseDir,
    });
    assert.ok(!evil.includes("<script>x</script>"));
    assert.ok(evil.includes("&lt;script&gt;"));
  });
  check("multi-item subtotal math", () => {
    const multi = generateHTML({
      config,
      data: {
        items: [
          { product: "A", quantity: 2, price: 50 },
          { product: "B", quantity: 1, price: 25 },
        ],
      },
      baseDir,
    });
    assert.ok(multi.includes("₹125.00"));
  });

  console.log("\nPDF generation:");
  const outPath = path.join(root, "output", "test-invoice.pdf");
  await generatePDF({ config, data, baseDir, outPath });
  check("writes a non-empty PDF file", () => {
    const stat = fs.statSync(outPath);
    assert.ok(stat.size > 1000, `PDF too small: ${stat.size} bytes`);
  });
  check("output is a valid PDF (magic header)", () => {
    const fd = fs.openSync(outPath, "r");
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    assert.strictEqual(buf.toString("utf8"), "%PDF-");
  });

  console.log("\nCSV parsing:");
  check("parses headers and rows", () => {
    const { headers, rows } = parseCSV("a,b,c\n1,2,3\n4,5,6\n");
    assert.deepStrictEqual(headers, ["a", "b", "c"]);
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0], { a: "1", b: "2", c: "3" });
  });
  check("handles quoted fields with embedded commas", () => {
    const { rows } = parseCSV('name,addr\nMd,"No 85, High Road, TN"\n');
    assert.strictEqual(rows[0].addr, "No 85, High Road, TN");
  });
  check("handles escaped quotes and no trailing newline", () => {
    const { rows } = parseCSV('q\n"say ""hi"""');
    assert.strictEqual(rows[0].q, 'say "hi"');
  });
  check("uses explicit fileName for naming", () => {
    assert.strictEqual(fileNameFor({ fileName: "c2063", orderNumber: "X" }, 0), "c2063.pdf");
  });
  check("renders extraDetails rows", () => {
    const html = generateHTML({
      config,
      data: { items: [], extraDetails: [{ label: "RRN", value: "430884970028" }] },
      baseDir,
    });
    assert.ok(html.includes("RRN:"));
    assert.ok(html.includes("430884970028"));
  });

  console.log("\nFile naming:");
  check("names file by order number", () => {
    assert.strictEqual(fileNameFor({ orderNumber: "PURQK" }, 0), "PURQK.pdf");
  });
  check("sanitizes unsafe characters in order number", () => {
    assert.strictEqual(fileNameFor({ orderNumber: "A/B 12:3" }, 0), "A_B_12_3.pdf");
  });
  check("falls back to invoice number then index", () => {
    assert.strictEqual(fileNameFor({ invoiceNumber: "INV9" }, 0), "INV9.pdf");
    assert.strictEqual(fileNameFor({}, 4), "invoice-5.pdf");
  });

  console.log("\nBatch generation:");
  const batch = JSON.parse(fs.readFileSync(path.join(root, "data/sample-batch.json"), "utf8"));
  const batchDir = path.join(root, "output", "test-batch");
  const results = await generatePDFsBatch({ config, invoices: batch, baseDir, outDir: batchDir });
  check("produces one PDF per invoice", () => {
    assert.strictEqual(results.length, batch.length);
    assert.ok(results.every((r) => r.ok), "some invoices failed");
  });
  check("files are named by order number", () => {
    for (const inv of batch) {
      const f = path.join(batchDir, `${inv.orderNumber}.pdf`);
      assert.ok(fs.existsSync(f), `missing ${f}`);
      assert.ok(fs.statSync(f).size > 1000);
    }
  });
  const dupDir = path.join(root, "output", "test-dup");
  await generatePDFsBatch({
    config,
    invoices: [{ orderNumber: "DUP", items: [] }, { orderNumber: "DUP", items: [] }],
    baseDir,
    outDir: dupDir,
  });
  check("deduplicates clashing order numbers", () => {
    assert.ok(fs.existsSync(path.join(dupDir, "DUP.pdf")));
    assert.ok(fs.existsSync(path.join(dupDir, "DUP-2.pdf")));
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
