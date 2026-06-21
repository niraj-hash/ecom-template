#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { generatePDFsBatch } = require("./index");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config" || a === "-c") args.config = argv[++i];
    else if (a === "--data" || a === "-d") args.data = argv[++i];
    else if (a === "--logo" || a === "-l") args.logo = argv[++i];
    else if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
Invoice PDF Generator — batch mode

Generates one PDF per order, named by order number, into an output directory.

Usage:
  node src/batch.js --data <invoices> --logo <logo> --out <dir> [options]

Options:
  -d, --data   <path>   JSON file with an ARRAY of invoices, OR a directory of
                        per-invoice .json files. (required)
  -l, --logo   <path>   Logo path/URL to use for every invoice (overrides config).
  -c, --config <file>   Company/branding config (default: config/company.json).
  -o, --out    <dir>    Output directory for the PDFs (default: output).
  -h, --help            Show this help.

Examples:
  node src/batch.js -d data/sample-batch.json -l assets/logo.svg -o output/batch
  node src/batch.js -d ./orders/ -l https://cdn.example.com/logo.png -o ./pdfs
`);
}

/**
 * Load invoices from either an array-JSON file or a directory of .json files.
 */
function loadInvoices(dataPath) {
  const stat = fs.statSync(dataPath);
  if (stat.isDirectory()) {
    const files = fs
      .readdirSync(dataPath)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .sort();
    if (!files.length) throw new Error(`No .json files found in directory: ${dataPath}`);
    return files.map((f) => JSON.parse(fs.readFileSync(path.join(dataPath, f), "utf8")));
  }
  const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  // Allow { invoices: [...] } wrapper, or a single invoice object.
  if (Array.isArray(parsed.invoices)) return parsed.invoices;
  return [parsed];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.data) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const configPath = path.resolve(args.config || path.join(projectRoot, "config/company.json"));
  const dataPath = path.resolve(args.data);
  const outDir = path.resolve(args.out || path.join(projectRoot, "output"));

  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(dataPath)) {
    console.error(`Invoice data not found: ${dataPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const invoices = loadInvoices(dataPath);
  const baseDir = projectRoot; // relative logo paths resolve from project root

  console.log(`Generating ${invoices.length} invoice PDF(s) → ${outDir}`);
  const results = await generatePDFsBatch({
    config,
    invoices,
    baseDir,
    outDir,
    logo: args.logo,
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
  console.error("Batch generation failed:", err.message);
  process.exit(1);
});
