"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Escape user-provided strings before injecting into HTML.
 */
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format a number as currency using the configured locale + symbol.
 */
function money(amount, currency, locale) {
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString(locale || "en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency}${formatted}`;
}

/**
 * Resolve the configured logo into an inline <img> src.
 * SVG/PNG/JPG files are embedded as data URIs so the PDF is self-contained.
 * A raw data: URI or http(s) URL in config is used as-is.
 */
function resolveLogo(logo, baseDir) {
  if (!logo) return null;
  if (/^(data:|https?:)/i.test(logo)) return logo;

  const filePath = path.isAbsolute(logo) ? logo : path.join(baseDir, logo);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Logo file not found: ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime =
    ext === "svg" ? "image/svg+xml" :
    ext === "png" ? "image/png" :
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
    ext === "gif" ? "image/gif" :
    "application/octet-stream";
  const data = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${data}`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Compute GST breakdown for tax-inclusive ecommerce pricing.
 * Tax can be supplied on the invoice data or derived from the configured rate.
 */
function computeTaxBreakdown(total, taxConfig, dataTax) {
  const cfg = taxConfig || {};
  const rate = Number(cfg.rate) || 0;
  const totalAmount = round2(total);
  const hasExplicitTax = dataTax !== undefined && dataTax !== null && dataTax !== "";
  let taxAmount = hasExplicitTax ? round2(dataTax) : rate > 0 ? round2(totalAmount * rate / (100 + rate)) : 0;
  const taxableValue = round2(totalAmount - taxAmount);
  const supplyType = cfg.supplyType === "inter" ? "inter" : "intra";

  const components =
    supplyType === "inter"
      ? [{ label: `IGST @ ${rate}%`, amount: taxAmount }]
      : [
          { label: `CGST @ ${round2(rate / 2)}%`, amount: round2(taxAmount / 2) },
          { label: `SGST @ ${round2(rate / 2)}%`, amount: round2(taxAmount - round2(taxAmount / 2)) },
        ];

  return { totalAmount, taxAmount, taxableValue, rate, supplyType, components, priceInclusive: cfg.priceInclusive !== false };
}

/**
 * Build the full invoice HTML document.
 *
 * @param {object} config  company.json contents (brand, address, invoice)
 * @param {object} data    invoice data (items, billTo, etc.)
 * @param {string} baseDir directory used to resolve a relative logo path
 */
function renderInvoiceHTML(config, data, baseDir) {
  const cfg = config || {};
  const brand = cfg.brand || {};
  const addr = cfg.address || {};
  const inv = cfg.invoice || {};
  const taxCfg = cfg.tax || {};

  const currency = inv.currency || "₹";
  const locale = inv.locale || "en-IN";
  const accent = inv.accentColor || "#000000";
  const priceInclusive = taxCfg.priceInclusive !== false;

  const items = Array.isArray(data.items) ? data.items : [];
  const subtotal =
    typeof data.subtotal === "number"
      ? data.subtotal
      : items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
  const total = typeof data.total === "number" ? data.total : subtotal;
  const taxBreakdown = computeTaxBreakdown(total, taxCfg, data.tax);
  const showTax = taxBreakdown.taxAmount > 0 || Number(taxCfg.rate) > 0;

  const logoSrc = resolveLogo(brand.logo, baseDir);
  const logoWidth = Number(brand.logoWidth) || 220;

  const billTo = data.billTo || {};

  const companyAddrLines = (addr.lines || [])
    .map((l) => `<div>${esc(l)}</div>`)
    .join("");

  const billToLines = (billTo.lines || [])
    .map((l) => `<div>${esc(l)}</div>`)
    .join("");

  const priceHeader = priceInclusive ? "Price (Incl. Tax)" : "Price";

  const itemRows = items
    .map(
      (it) => `
        <tr>
          <td class="prod">${esc(it.product)}</td>
          <td class="qty">${esc(it.quantity)}</td>
          <td class="price">${money(it.price, currency, locale)}</td>
        </tr>`
    )
    .join("");

  const taxRows = showTax
    ? `
        <tr class="sub tax-row">
          <td class="label">Taxable Value</td>
          <td class="amount">${money(taxBreakdown.taxableValue, currency, locale)}</td>
        </tr>
        ${taxBreakdown.components
          .map(
            (c) => `
        <tr class="sub tax-row">
          <td class="label">${esc(c.label)}</td>
          <td class="amount">${money(c.amount, currency, locale)}</td>
        </tr>`
          )
          .join("")}`
    : "";

  const inclusiveNote = showTax && priceInclusive
    ? `<div class="tax-inclusive-note">All prices are inclusive of applicable taxes.</div>`
    : "";

  const footerNote = inv.footerNote
    ? `<div class="footer-note">${esc(inv.footerNote)}</div>`
    : "";

  const logoBlock = logoSrc
    ? `<img class="logo" src="${esc(logoSrc)}" style="width:${logoWidth}px" alt="logo" />`
    : `<div class="logo-fallback">${esc(brand.name || "")}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #ffffff;
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1f2937;
    font-size: 13px;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { padding: 40px 44px; }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 32px;
    padding-bottom: 20px;
    border-bottom: 2px solid ${accent};
  }
  .logo { display: block; max-width: 100%; height: auto; }
  .logo-fallback { font-size: 24px; font-weight: 800; }
  .company { text-align: right; max-width: 320px; font-size: 12px; line-height: 1.5; }
  .company .name { font-weight: 700; margin-bottom: 4px; font-size: 13px; color: #111827; }
  .company div { color: #4b5563; }

  h1.invoice-title {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 3px;
    color: #111827;
    margin: 24px 0 16px;
  }

  .meta { display: flex; justify-content: space-between; gap: 32px; margin-bottom: 28px; }
  .section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #9ca3af;
    margin-bottom: 5px;
  }
  .bill-to { max-width: 320px; font-size: 12px; line-height: 1.5; }
  .bill-to .name { font-weight: 600; color: #111827; margin-bottom: 1px; }
  .bill-to div { color: #4b5563; }

  .details { min-width: 300px; }
  .details .row { display: flex; gap: 12px; margin-bottom: 4px; font-size: 12px; }
  .details .label { color: #6b7280; min-width: 120px; }
  .details .value { font-weight: 600; color: #111827; word-break: break-all; }

  table.items { width: 100%; border-collapse: collapse; }
  table.items thead th {
    background: ${accent};
    color: #fff;
    text-align: left;
    padding: 9px 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  table.items thead th.qty { text-align: center; width: 90px; }
  table.items thead th.price { text-align: right; width: 130px; }
  table.items tbody td {
    padding: 10px 12px;
    border-bottom: 1px solid #eceff3;
    font-size: 12.5px;
  }
  table.items tbody td.qty { text-align: center; }
  table.items tbody td.price { text-align: right; font-variant-numeric: tabular-nums; }

  .totals { display: flex; justify-content: flex-end; margin-top: 14px; }
  .totals table { border-collapse: collapse; min-width: 260px; }
  .totals td { padding: 7px 12px; font-size: 12.5px; }
  .totals .label { color: #4b5563; text-align: left; }
  .totals .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .totals .sub td { border-bottom: 1px solid #e5e7eb; }
  .totals .total td { border-top: 2px solid #111827; font-weight: 700; color: #111827; padding-top: 9px; }
  .totals .total .amount { font-size: 15px; }
  .totals .tax-row td { font-size: 11.5px; color: #6b7280; }
  .tax-inclusive-note { margin-top: 8px; text-align: right; font-size: 11px; color: #6b7280; }
  .company .tax-id { margin-top: 6px; font-size: 11px; color: #374151; }
  .company .tax-id span { font-weight: 600; color: #111827; }

  .footer-note { margin-top: 28px; padding-top: 14px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 11px; }
</style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="logo-wrap">${logoBlock}</div>
      <div class="company">
        <div class="name">${esc(brand.name || "")}</div>
        ${companyAddrLines}
        ${addr.phone ? `<div>${esc(addr.phone)}</div>` : ""}
        ${addr.email ? `<div>${esc(addr.email)}</div>` : ""}
        ${taxCfg.gstin ? `<div class="tax-id"><span>GSTIN:</span> ${esc(taxCfg.gstin)}</div>` : ""}
        ${taxCfg.pan ? `<div class="tax-id"><span>PAN:</span> ${esc(taxCfg.pan)}</div>` : ""}
      </div>
    </div>

    <h1 class="invoice-title">INVOICE</h1>

    <div class="meta">
      <div class="bill-to">
        <div class="section-label">Bill To</div>
        <div class="name">${esc(billTo.name || "")}</div>
        ${billToLines}
        ${billTo.email ? `<div>${esc(billTo.email)}</div>` : ""}
        ${billTo.phone ? `<div>${esc(billTo.phone)}</div>` : ""}
      </div>
      <div class="details">
        <div class="section-label">Invoice Details</div>
        ${data.invoiceNumber ? `<div class="row"><span class="label">Invoice Number:</span><span class="value">${esc(data.invoiceNumber)}</span></div>` : ""}
        ${data.orderNumber ? `<div class="row"><span class="label">Order Number:</span><span class="value">${esc(data.orderNumber)}</span></div>` : ""}
        ${data.orderDate ? `<div class="row"><span class="label">Order Date:</span><span class="value">${esc(data.orderDate)}</span></div>` : ""}
        ${data.paymentMethod ? `<div class="row"><span class="label">Payment Method:</span><span class="value">${esc(data.paymentMethod)}</span></div>` : ""}
        ${(Array.isArray(data.extraDetails) ? data.extraDetails : [])
          .filter((d) => d && d.label && d.value !== undefined && d.value !== "")
          .map((d) => `<div class="row"><span class="label">${esc(d.label)}:</span><span class="value">${esc(d.value)}</span></div>`)
          .join("")}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="prod">Product</th>
          <th class="qty">Quantity</th>
          <th class="price">${priceHeader}</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr class="sub">
          <td class="label">${priceInclusive ? "Amount (Incl. Tax)" : "Subtotal"}</td>
          <td class="amount">${money(subtotal, currency, locale)}</td>
        </tr>
        ${taxRows}
        <tr class="total">
          <td class="label">Total</td>
          <td class="amount">${money(total, currency, locale)}</td>
        </tr>
      </table>
    </div>

    ${inclusiveNote}
    ${footerNote}
  </div>
</body>
</html>`;
}

module.exports = { renderInvoiceHTML, money, esc, resolveLogo, computeTaxBreakdown, round2 };
