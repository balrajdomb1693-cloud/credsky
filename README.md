# SkyCred

A lightweight weather dashboard with a credit-score-inspired visual identity. Search a city, see current conditions on a temperature dial, and inspect the underlying API response through formatted and raw JSON views.

Built to the SkyCred MVP PRD (v1.0) — plain HTML/CSS/JS with a single serverless function so the WeatherAPI.com key never reaches the browser.

## Features (MVP scope)

| PRD | Feature | Where |
|-----|---------|-------|
| FR1 | City search (empty submissions blocked, loading/error states, failures never overwrite previous results) | `app.js` |
| FR2 | Current weather dashboard — temperature dial, feels-like, humidity, wind, UV, condition icon, last-updated & local time | `index.html` / `app.js` |
| FR3 | Popular city chips (Mumbai, Pune, Delhi, Bengaluru, Hyderabad, Chennai) rendered from the single `POPULAR_CITIES` config in `app.js`, with the selected city highlighted | `index.html` / `app.js` |
| FR4 | Formatted JSON & raw JSON tabs — both derived from the same successful response, no refetch on switch | `app.js` |
| FR5 | Copy with visible confirmation and graceful clipboard-failure handling | `app.js` |
| FR6 | WeatherAPI.com integration via server-side proxy; errors, rate limits and network failures mapped to friendly messages | `api/weather.js` |
| §7.3/§9 | Short-lived server-side cache (5-minute TTL per warm instance) + CDN cache headers to reduce provider calls | `api/weather.js` |

**Out of scope (per PRD):** multi-day forecast, severe weather alerts, accounts/profiles, historical comparisons, air quality, and any actual "score" — the credit-score dial is branding only and shows temperature.

## Project structure

```
├── index.html        # Single-page UI (search, dashboard, JSON views)
├── styles.css        # Credit-score-inspired styling (dark, gauge dial)
├── app.js            # Client logic + analytics event instrumentation
├── api/weather.js    # Serverless proxy to WeatherAPI.com (key stays here)
├── server.js         # Zero-dependency local dev server (mirrors Vercel)
├── .env.example      # Template for the API key
└── .gitignore        # Keeps .env and .vercel out of version control
```

## Setup

1. Get a free API key at [weatherapi.com](https://www.weatherapi.com/).
2. Copy `.env.example` to `.env` and paste your key:

   ```
   WEATHER_API_KEY=your_key_here
   ```

### Run locally

Requires Node 18+:

```
node server.js
```

Then open http://localhost:3000

### Deploy to Vercel

This repository deploys to the Vercel project **`credsky`**:

- **Production URL:** https://credsky-three.vercel.app
- The WeatherAPI key is configured server-side as `WEATHER_API_KEY`
  (Project Settings → Environment Variables) and is never exposed to the browser.
- The proxy is available at `/api/weather` in production.

### CI/CD (deploy on push)

Two supported ways to make every push to `main` deploy automatically:

1. **Native Vercel Git integration (recommended).** One-time, interactive:
   - In Vercel: Account Settings → **Login Connections** → connect GitHub.
   - Then Project `credsky` → Settings → Git → connect `balrajdomb1693-cloud/credsky`.
   After this, pushes to `main` deploy automatically and `.github/workflows/deploy.yml` can be deleted.

2. **GitHub Actions.** Push `.github/workflows/deploy.yml` (present in the working tree;
   note: pushing workflow files requires a GitHub token with the `workflow` scope) and add a
   repository secret `VERCEL_TOKEN` under Settings → Secrets and variables → Actions.
   The workflow deploys to production on every push to `main` and skips gracefully
   while the secret is not set.

Manual production deploy from a machine with Vercel CLI auth:

```
npx vercel deploy --prod --yes --token <VERCEL_TOKEN>
```

## Analytics events (PRD §11)

Instrumented via a pluggable hook — replace `window.skycredAnalytics` with a real provider (e.g. GA4/Plausible) to activate:

- `city_search_submitted` — { query }
- `weather_search_success` — { query, resolved_location, latency_ms }
- `weather_search_failed` — { query, status, code, reason, latency_ms }
- `popular_city_selected` — { city }
- `json_view_switched` — { view }
- `weather_data_copied` — { view, success }

No personal information is collected; queries are city names only.

## Error handling

| Situation | Behaviour |
|-----------|-----------|
| Empty search | Blocked client-side with a prompt; never submitted |
| Unknown city | `404 LOCATION_NOT_FOUND` → friendly "not found" banner + retry |
| Rate limit (429) | "Too many requests" banner + retry |
| Invalid/expired key | `502 SERVICE_CONFIG` (never leaks the key) |
| Network failure | "Network problem" banner + retry |
| Previous success | Retained on failure — failed searches never overwrite displayed data |

## Credit

Weather data by [WeatherAPI.com](https://www.weatherapi.com/).
