/**
 * SkyCred — WeatherAPI.com proxy (Vercel serverless function)
 *
 * GET /api/weather?city=<name>
 *
 * The WeatherAPI.com key lives ONLY here (server-side env var
 * WEATHER_API_KEY) — it is never exposed to the client (FR6).
 *
 * Error mapping (client-facing, never leaks credentials):
 *   missing city          -> 400 MISSING_CITY
 *   no matching location  -> 404 LOCATION_NOT_FOUND
 *   rate limited          -> 429 RATE_LIMITED
 *   key invalid/disabled  -> 502 SERVICE_CONFIG (upstream 401/403)
 *   upstream unreachable  -> 502 UPSTREAM_ERROR
 */

const UPSTREAM = "https://api.weatherapi.com/v1/current.json";

// PRD 7.3/9 — short-lived cache keyed by normalized city, to reduce
// repeated provider calls. Lives per warm serverless instance.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (PRD proposal)
const CACHE_MAX_ENTRIES = 100;
const SUCCESS_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=240";
const cache = new Map(); // key: normalized city -> { expires, body }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit;
}

function cacheSet(key, body) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value); // evict oldest insertion
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, body });
}

function sendSuccess(res, body) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", SUCCESS_CACHE_CONTROL);
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET for weather lookups." } });
    return;
  }

  // Parse query from the URL (works on Vercel and plain Node alike).
  let city = "";
  try {
    const url = new URL(req.url, "http://localhost");
    city = String(url.searchParams.get("city") || "").trim();
  } catch (e) {
    city = "";
  }

  if (!city) {
    sendJson(res, 400, { error: { code: "MISSING_CITY", message: "A city name is required." } });
    return;
  }
  if (city.length > 100) {
    sendJson(res, 400, { error: { code: "CITY_TOO_LONG", message: "City name is too long." } });
    return;
  }

  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error: { code: "SERVICE_CONFIG", message: "Weather service is not configured. Set the WEATHER_API_KEY environment variable." }
    });
    return;
  }

  // Serve from the short-lived cache when we have fresh data for this city.
  const cacheKey = city.toLowerCase().replace(/\s+/g, " ");
  const cached = cacheGet(cacheKey);
  if (cached) {
    sendSuccess(res, cached.body);
    return;
  }

  const upstreamUrl = `${UPSTREAM}?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(city)}&aqi=no`;

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, { headers: { Accept: "application/json" } });
  } catch (e) {
    sendJson(res, 502, { error: { code: "UPSTREAM_ERROR", message: "The weather service is unreachable. Please try again shortly." } });
    return;
  }

  const body = await upstreamRes.text();

  if (!upstreamRes.ok) {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) { /* ignore */ }
    const status = upstreamRes.status;

    if (status === 400) {
      // WeatherAPI uses 400 for "no matching location" (code 1006).
      sendJson(res, 404, {
        error: { code: "LOCATION_NOT_FOUND", message: "No matching location was found for that search." }
      });
      return;
    }
    if (status === 401 || status === 403) {
      sendJson(res, 502, {
        error: { code: "SERVICE_CONFIG", message: "The weather service rejected the request. The API key may be invalid or expired." }
      });
      return;
    }
    if (status === 429) {
      sendJson(res, 429, {
        error: { code: "RATE_LIMITED", message: "Too many weather requests right now. Please wait a moment and try again." }
      });
      return;
    }
    sendJson(res, 502, {
      error: { code: "UPSTREAM_ERROR", message: "The weather service returned an error. Please try again shortly." }
    });
    return;
  }

  // Success: cache the raw upstream JSON, then pass it straight through.
  cacheSet(cacheKey, body);
  sendSuccess(res, body);
};
