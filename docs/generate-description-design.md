# Design — Generate a compliant description (+ keep rewrite)

**Date:** 2026-06-01
**Status:** Approved

## Goal

Replace the single "AI rewrite" button with two modes:

1. **Generate from facts** — the agent enters an address + property facts; the
   Worker pulls live neighborhood context from Google Maps and Claude writes a
   short, Fair-Housing-compliant listing description.
2. **Rewrite listing** — the original behavior: paste a listing, get a compliant
   rewrite. No Maps.

No Zillow. Property facts are supplied by the agent (Zillow has no legitimate
free API and scraping it breaks ToS).

## Flow

```
Browser (index.html)                 Cloudflare Worker
--------------------                 -----------------
mode = generate                      POST {mode:"generate", address, facts}
  address + facts        ───────▶      1. Geocode address (Google Geocoding API)
                                        2. Nearby Search (Google Places API New),
                                           neutral categories only, distances
                                        3. Claude (Opus) writes ~90–120 words
                         ◀───────      Anthropic response (content[].text)
  show text + auto-scan "✓ 0 flags"

mode = rewrite                       POST {mode:"rewrite", text}
  pasted listing         ───────▶      Claude (Sonnet) compliant rewrite
                         ◀───────      Anthropic response
```

## Compliance handling (critical)

Google Maps will surface places of worship, school ratings, and "walkable"
framing — the exact things the rule pack flags. Mitigations:

- The Worker **never queries** sensitive categories (worship, schools).
- It also **filters defensively**: any returned place whose `types` include a
  blocked category (`place_of_worship`, `school`, `university`, `cemetery`, …)
  is dropped before reaching Claude.
- The generate system prompt forbids steering/coded language and buyer-targeting.
- After generation, the page re-runs the rule pack on the output and shows the
  flag count as proof.

## Models

- Generate: `claude-opus-4-8` (Opus — per request; ~90–120 words, `max_tokens` ≈ 400)
- Rewrite: `claude-sonnet-4-6` (cheaper, sufficient)

Both are named constants at the top of `worker/worker.js`.

## Secrets (Worker only)

- `ANTHROPIC_API_KEY`
- `GOOGLE_MAPS_API_KEY` (Geocoding API + Places API (New) enabled)

Generate degrades gracefully: if the Maps key is missing or geocoding fails, it
still writes a description from the facts alone.

## Files changed

- `index.html` — mode toggle, address field, dynamic labels, two-path button,
  compliance-proof badge.
- `worker/worker.js` — geocode + nearby helpers, `generate`/`rewrite` branches.
- `README.md` — Google Maps key + two-mode docs.
