#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { parseCSV } = require("./csv");
const { generatePDFsBatch } = require("./index");
const { computeTaxBreakdown } = require("./template");

// Default CSV column -> invoice field mapping (matches the Airpay export).
const DEFAULT_COLS = {
  name: "C Number",            // used for the PDF file name + Invoice Number
  orderNumber: "Airpay ID",    // shown as "Order Number"
  date: "Txn Date",            // shown as "Order Date"
  amount: "Txn Amount",        // line-item price
  payChannel: "Pay Channel",   // shown as "Payment Method"
  rrn: "RRN",                  // shown as an extra "RRN" detail
  custName: "Cust Name",
  phone: "Cust Phone Number",
  email: "Cust Gmail",
  address: "Cust Address",
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") args.csv = argv[++i];
    else if (a === "--name" || a === "-n") args.name = argv[++i];
    else if (a === "--logo" || a === "-l") args.logo = argv[++i];
    else if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (a === "--config" || a === "-c") args.config = argv[++i];
    else if (a === "--product" || a === "-p") args.product = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
Invoice PDF Generator — CSV batch mode

Reads a CSV of order rows and writes one PDF per row, named by a chosen column.

Usage:
  node src/csv-batch.js --csv <file> [options]

Options:
  --csv     <file>   CSV file with order rows (required)
  -n, --name <col>   Column used for the PDF file name (default: "C Number")
  -l, --logo <path>  Logo path/URL applied to every invoice (overrides config)
  -o, --out  <dir>   Output directory (default: output/csv)
  -c, --config <f>   Company/branding config (default: config/company.json)
  -p, --product <s>  Line-item label for each order (default: "Online Purchase")
  -h, --help         Show this help

Example:
  node src/csv-batch.js --csv orders.csv --name "C Number" --logo logo.png --out output/csv
`);
}

function num(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function rowToInvoice(row, cols, product, taxConfig) {
  const get = (col) => (col && row[col] !== undefined ? String(row[col]).trim() : "");
  const address = get(cols.address);
  const lines = address ? address.split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [];
  const cNumber = get(cols.name);
  const price = num(get(cols.amount));
  const { taxAmount } = computeTaxBreakdown(price, taxConfig);

  const extraDetails = [];
  const rrn = get(cols.rrn);
  if (rrn) extraDetails.push({ label: "RRN", value: rrn });

  return {
    fileName: cNumber,
    invoiceNumber: cNumber,
    orderNumber: get(cols.orderNumber),
    orderDate: get(cols.date),
    paymentMethod: get(cols.payChannel),
    extraDetails,
    billTo: {
      name: get(cols.custName),
      lines,
      email: get(cols.email),
      phone: get(cols.phone),
    },
    items: [{ product, quantity: 1, price }],
    tax: taxAmount,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.csv) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const csvPath = path.resolve(args.csv);
  const configPath = path.resolve(args.config || path.join(projectRoot, "config/company.json"));
  const outDir = path.resolve(args.out || path.join(projectRoot, "output/csv"));
  const product = args.product || "Online Purchase";

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const cols = { ...DEFAULT_COLS };
  if (args.name) cols.name = args.name;

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const { headers, rows } = parseCSV(fs.readFileSync(csvPath, "utf8"));

  if (!rows.length) {
    console.error("No data rows found in CSV.");
    process.exit(1);
  }
  if (!headers.includes(cols.name)) {
    console.error(
      `Naming column "${cols.name}" not found in CSV.\nAvailable columns: ${headers.join(", ")}`
    );
    process.exit(1);
  }

  const invoices = rows.map((r) => rowToInvoice(r, cols, product, config.tax));

  // Default logo: prefer an explicit --logo, else logo.png at project root if it exists.
  let logo = args.logo;
  if (!logo) {
    const rootPng = path.join(projectRoot, "logo.png");
    if (fs.existsSync(rootPng)) logo = "logo.png";
  }

  console.log(`Generating ${invoices.length} invoice PDF(s) from CSV → ${outDir}`);
  if (logo) console.log(`Using logo: ${logo}`);

  const results = await generatePDFsBatch({
    config,
    invoices,
    baseDir: projectRoot,
    outDir,
    logo,
    onProgress: (r, i, total) => {
      const tag = `[${i + 1}/${total}]`;
      if (r.ok) console.log(`  ${tag} ✓ ${path.basename(r.file)}`);
      else console.error(`  ${tag} ✗ ${path.basename(r.file)} — ${r.error}`);
    },
  });

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  console.log(`\nDone: ${ok} succeeded${failed ? `, ${failed} failed` : ""}.`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("CSV batch generation failed:", err.message);
  process.exit(1);
});
