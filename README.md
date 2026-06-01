# Clearwrite

Compliance redlining for real-estate listing copy. A static landing page +
demo tool, hosted on **GitHub Pages**, with the optional **AI rewrite** powered
by Claude through a tiny **Cloudflare Worker** proxy.

## What's here

| Path | What it is |
|------|------------|
| `index.html` | The whole site + the Fair Housing rule-pack scanner (runs in the browser). |
| `worker/` | Cloudflare Worker that keeps the Anthropic API key secret and powers the **AI rewrite** button. |

## Buttons & how they work

- **Scan a listing → / See the rule packs** — in-page anchor links.
- **Scan copy** — runs the Fair Housing rule pack locally in the browser. No network.
- **AI rewrite →** — POSTs the listing to the Cloudflare Worker, which calls Claude and returns a compliant rewrite.
- **Copy** — copies the rewrite to the clipboard.

## Deploying the Worker (needed for the AI rewrite button)

You need an [Anthropic API key](https://console.anthropic.com/) and a free
[Cloudflare account](https://dash.cloudflare.com/sign-up).

```bash
cd worker
npx wrangler login                        # opens a browser to authorize Cloudflare
npx wrangler secret put ANTHROPIC_API_KEY # paste your key when prompted (hidden input)
npx wrangler deploy                       # prints your Worker URL
```

After deploy, put the printed URL into `index.html`:

```js
const WORKER_URL = "https://clearwrite-proxy.<your-subdomain>.workers.dev";
```

…then commit and push. GitHub Pages redeploys automatically.

### Locking the Worker to your site

`worker/worker.js` has an `ALLOWED_ORIGINS` list. Keep your GitHub Pages origin
(and any custom domain) in it so other websites can't drive your API key from a
browser. (CORS only blocks browsers; for stronger protection add a rate limit or
a shared token.)

## Hosting

GitHub Pages serves `index.html` from the repo root on the `main` branch.
