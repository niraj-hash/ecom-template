"use strict";

/**
 * Minimal RFC-4180-ish CSV parser.
 * Handles quoted fields, embedded commas, escaped quotes ("") and CRLF/LF.
 * Returns { headers: string[], rows: Array<Record<string,string>> }.
 */
function parseCSV(text) {
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (c === "\r") {
      // ignore; handled by the following \n
    } else {
      field += c;
    }
  }
  // Flush trailing field/record (file may not end with a newline).
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Drop fully-empty trailing rows.
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] !== undefined ? cells[idx] : "").trim();
    });
    return obj;
  });

  return { headers, rows };
}

module.exports = { parseCSV };
