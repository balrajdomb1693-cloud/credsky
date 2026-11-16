/**
 * SkyCred — zero-dependency local dev server.
 * Serves the static site and mounts api/weather.js at /api/weather,
 * mirroring the Vercel production behaviour.
 *
 * Usage:  node server.js   (then open http://localhost:3000)
 * Requires WEATHER_API_KEY in the environment or in a .env file.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

// Tiny .env loader (no dependencies).
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const weatherHandler = require("./api/weather.js");

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/weather") {
    req.url = url.pathname + url.search; // handler re-parses query params
    try {
      await weatherHandler(req, res);
    } catch (e) {
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: { code: "INTERNAL", message: "Unexpected server error." } }));
      }
    }
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  // Prevent path traversal.
  const filePath = path.join(ROOT, path.normalize(pathname).replace(/^([.][.][/\\])+/, ""));
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`SkyCred dev server running at http://localhost:${PORT}`);
  if (!process.env.WEATHER_API_KEY) {
    console.warn("WARNING: WEATHER_API_KEY is not set — create a .env file or set the environment variable.");
  }
});
