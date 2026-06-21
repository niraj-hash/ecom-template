"use strict";

const fs = require("fs");
const path = require("path");
const { renderInvoiceHTML } = require("./template");

let puppeteer = null;
function getPuppeteer() {
  if (!puppeteer) {
    // Lazy require so renderInvoiceHTML() can be used without puppeteer installed.
    puppeteer = require("puppeteer");
  }
  return puppeteer;
}

/**
 * Generate invoice HTML as a string.
 * @param {object} opts { config, data, baseDir }
 */
function generateHTML({ config, data, baseDir }) {
  return renderInvoiceHTML(config, data, baseDir || process.cwd());
}

/**
 * Generate an invoice PDF.
 *
 * @param {object} opts
 * @param {object} opts.config   company config object
 * @param {object} opts.data     invoice data object
 * @param {string} opts.baseDir  directory for resolving the relative logo path
 * @param {string} [opts.outPath] if provided, the PDF is written to this path
 * @returns {Promise<Buffer>} the PDF bytes
 */
async function generatePDF({ config, data, baseDir, outPath }) {
  const html = generateHTML({ config, data, baseDir });
  const pp = getPuppeteer();

  const browser = await pp.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, pdf);
    }
    return pdf;
  } finally {
    await browser.close();
  }
}

/**
 * Turn an order/invoice into a safe file name.
 * Prefers order number, then invoice number, then a fallback.
 */
function fileNameFor(invoice, index) {
  const raw =
    invoice.fileName ||
    invoice.orderNumber ||
    invoice.invoiceNumber ||
    `invoice-${index + 1}`;
  const safe = String(raw)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${safe || `invoice-${index + 1}`}.pdf`;
}

/**
 * Generate one PDF per invoice, named by order number, into outDir.
 * A single browser instance is reused across all invoices.
 *
 * @param {object} opts
 * @param {object}   opts.config    company config object
 * @param {object[]} opts.invoices  array of invoice data objects
 * @param {string}   opts.baseDir   directory for resolving the relative logo path
 * @param {string}   opts.outDir    directory to write the PDFs into
 * @param {string}   [opts.logo]    optional logo path/URL overriding config.brand.logo
 * @param {function} [opts.onProgress] called as (result) after each invoice
 * @returns {Promise<Array<{file,orderNumber,ok,error}>>}
 */
async function generatePDFsBatch({ config, invoices, baseDir, outDir, logo, onProgress }) {
  if (!Array.isArray(invoices)) {
    throw new Error("invoices must be an array");
  }
  const dir = baseDir || process.cwd();
  const out = outDir || path.join(process.cwd(), "output");
  fs.mkdirSync(out, { recursive: true });

  // Apply a logo override (does not mutate the caller's config).
  const effectiveConfig = logo
    ? { ...config, brand: { ...(config.brand || {}), logo } }
    : config;

  const pp = getPuppeteer();
  const browser = await pp.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results = [];
  const usedNames = new Set();
  try {
    for (let i = 0; i < invoices.length; i++) {
      const invoice = invoices[i];
      let fileName = fileNameFor(invoice, i);
      // Guard against duplicate order numbers clobbering each other.
      if (usedNames.has(fileName)) {
        const base = fileName.replace(/\.pdf$/i, "");
        let n = 2;
        while (usedNames.has(`${base}-${n}.pdf`)) n++;
        fileName = `${base}-${n}.pdf`;
      }
      usedNames.add(fileName);
      const filePath = path.join(out, fileName);

      const result = { file: filePath, orderNumber: invoice.orderNumber || null, ok: false, error: null };
      try {
        const html = renderInvoiceHTML(effectiveConfig, invoice, dir);
        const page = await browser.newPage();
        try {
          await page.setContent(html, { waitUntil: "networkidle0" });
          const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "0", right: "0", bottom: "0", left: "0" },
          });
          fs.writeFileSync(filePath, pdf);
          result.ok = true;
        } finally {
          await page.close();
        }
      } catch (err) {
        result.error = err.message;
      }
      results.push(result);
      if (typeof onProgress === "function") onProgress(result, i, invoices.length);
    }
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = {
  generateHTML,
  generatePDF,
  generatePDFsBatch,
  fileNameFor,
  renderInvoiceHTML,
};
