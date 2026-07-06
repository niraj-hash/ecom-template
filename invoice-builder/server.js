"use strict";
// Static server for the invoice builder + a tiny print-counter API.
// The counter is persisted to a plain text file in the repo (print-count.txt).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 4599;
const COUNT_FILE = path.join(ROOT, "print-count.txt");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain" };

function readCount() {
  try {
    const n = parseInt(fs.readFileSync(COUNT_FILE, "utf8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}
function writeCount(n) {
  fs.writeFileSync(COUNT_FILE, String(n) + "\n");
}
function sendJSON(res, obj) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);

  // --- print counter API ---
  if (urlPath === "/print-count") {
    if (req.method === "GET") {
      return sendJSON(res, { count: readCount() });
    }
    if (req.method === "POST") {
      const next = readCount() + 1;
      writeCount(next);
      return sendJSON(res, { count: next });
    }
    res.writeHead(405); return res.end("Method not allowed");
  }

  // --- static files ---
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}).listen(PORT, () => console.log("Invoice builder on http://localhost:" + PORT));
