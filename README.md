# Clearwrite

Compliance redlining for real-estate listing copy. A static landing page +
demo tool, hosted on **GitHub Pages**, with AI features powered by Claude
through a tiny **Cloudflare Worker** proxy that also calls **Google Maps**.

## What's here

| Path | What it is |
|------|------------|
| `index.html` | The whole site + the Fair Housing rule-pack scanner (runs in the browser). |
| `worker/` | Cloudflare Worker that keeps the API keys secret and powers the AI features. |
| `docs/` | Design notes. |

## Buttons & how they work

- **Scan a listing → / See the rule packs** — in-page anchor links.
- **Scan copy** — runs the Fair Housing rule pack locally in the browser. No network.
- **Generate from facts** (mode) — enter an address + property facts; the Worker
  geocodes the address, pulls **neutral** nearby places from Google Maps
  (parks, transit, grocery… never schools or places of worship), and Claude
  (Opus) writes a short, compliant description. The page then re-scans the output
  and shows **"✓ 0 flags"** as proof.
- **Rewrite listing** (mode) — paste a listing; Claude (Sonnet) returns a
  compliant rewrite. No Maps.
- **Copy** — copies the result to the clipboard.

## Deploying the Worker (needed for Generate / Rewrite)

You need an [Anthropic API key](https://console.anthropic.com/), a
[Google Maps Platform key](https://console.cloud.google.com/) with **Geocoding API**
and **Places API (New)** enabled, and a free
[Cloudflare account](https://dash.cloudflare.com/sign-up).

```bash
cd worker
npx wrangler login                            # opens a browser to authorize Cloudflare
npx wrangler secret put ANTHROPIC_API_KEY     # paste your Anthropic key (hidden)
npx wrangler secret put GOOGLE_MAPS_API_KEY   # paste your Google Maps key (hidden)
npx wrangler deploy                           # prints your Worker URL
```

After deploy, put the printed URL into `index.html`:

```js
const WORKER_URL = "https://clearwrite-proxy.<your-subdomain>.workers.dev";
```

…then commit and push. GitHub Pages redeploys automatically.

> Generate mode degrades gracefully: if the Google Maps key is missing or the
> address can't be geocoded, it still writes a description from the facts alone.

### Models

Set at the top of `worker/worker.js`:

- `MODEL_GENERATE = "claude-opus-4-8"` — Opus, for descriptions (pricier; ~90–120 words).
- `MODEL_REWRITE  = "claude-sonnet-4-6"` — Sonnet, for the rewrite path.

### Locking the Worker to your site

`worker/worker.js` has an `ALLOWED_ORIGINS` list. Keep your GitHub Pages origin
(and any custom domain) in it so other websites can't drive your API keys from a
browser. (CORS only blocks browsers; for stronger protection add a rate limit or
a shared token.)

## Hosting

GitHub Pages serves `index.html` from the repo root on the `main` branch.
