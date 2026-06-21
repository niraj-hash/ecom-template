#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { generatePDF, generateHTML } = require("./index");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config" || a === "-c") args.config = argv[++i];
    else if (a === "--data" || a === "-d") args.data = argv[++i];
    else if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (a === "--html") args.html = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function printHelp() {
  console.log(`
Invoice PDF Generator

Usage:
  invoice --data <invoice.json> [options]

Options:
  -c, --config <file>   Company/branding config (default: config/company.json)
  -d, --data   <file>   Invoice data JSON (required)
  -o, --out    <file>   Output PDF path (default: output/invoice.pdf)
      --html            Also write the rendered HTML next to the PDF
  -h, --help            Show this help

Examples:
  invoice --data data/sample-invoice.json
  invoice -c config/company.json -d data/sample-invoice.json -o output/PURQK.pdf
`);
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
  const outPath = path.resolve(args.out || path.join(projectRoot, "output/invoice.pdf"));

  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(dataPath)) {
    console.error(`Invoice data not found: ${dataPath}`);
    process.exit(1);
  }

  const config = readJSON(configPath);
  const data = readJSON(dataPath);
  // Relative logo paths in config are resolved from the project root.
  const baseDir = projectRoot;

  if (args.html) {
    const html = generateHTML({ config, data, baseDir });
    const htmlOut = outPath.replace(/\.pdf$/i, "") + ".html";
    fs.mkdirSync(path.dirname(htmlOut), { recursive: true });
    fs.writeFileSync(htmlOut, html);
    console.log(`HTML written: ${htmlOut}`);
  }

  await generatePDF({ config, data, baseDir, outPath });
  console.log(`PDF written: ${outPath}`);
}

main().catch((err) => {
  console.error("Failed to generate invoice:", err.message);
  process.exit(1);
});
