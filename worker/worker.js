/* ============================================================
   Clearwrite — Cloudflare Worker proxy for the AI rewrite button.

   Why this exists: GitHub Pages is static, so the browser can't call
   api.anthropic.com directly (no place to keep the API key, and CORS
   blocks it). This Worker holds the key as a secret, owns the system
   prompt, and forwards the request to Claude.

   Deploy:
     cd worker
     npx wrangler login
     npx wrangler secret put ANTHROPIC_API_KEY   # paste your key (hidden)
     npx wrangler deploy
   ============================================================ */

const SYSTEM_PROMPT =
  "You are a Fair Housing compliance editor for U.S. real estate listings. " +
  "Rewrite the listing to comply with the federal Fair Housing Act (42 U.S.C. 3604(c)): " +
  "describe the property and its features, never the type of person who would live there. " +
  "Remove any language implying a preference, limitation, or discrimination based on race, color, " +
  "religion, sex, disability, familial status, or national origin. Preserve every factual detail " +
  "(beds, baths, square footage, real features). Keep it engaging and natural, about 170-210 words. " +
  "Return ONLY the rewritten listing text — no preamble, no notes, no quotation marks.";

// Browser origins allowed to call this Worker. Add your custom domain here too.
const ALLOWED_ORIGINS = [
  "https://harrypotter696969.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const MODEL = "claude-sonnet-4-6";
const MAX_INPUT_CHARS = 8000;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get("Origin") || "");

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "Server missing API key" }, 500, cors);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const text = (payload && typeof payload.text === "string") ? payload.text.trim() : "";
    if (!text) return json({ error: "Missing 'text'" }, 400, cors);
    if (text.length > MAX_INPUT_CHARS) return json({ error: "Listing too long" }, 413, cors);

    let aRes;
    try {
      aRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        }),
      });
    } catch (e) {
      return json({ error: "Upstream request failed" }, 502, cors);
    }

    const data = await aRes.json().catch(() => null);
    if (!aRes.ok) {
      const msg = (data && data.error && data.error.message) || ("Anthropic HTTP " + aRes.status);
      return json({ error: msg }, aRes.status, cors);
    }
    // Forward Anthropic's response shape unchanged — the page reads data.content[].text
    return json(data, 200, cors);
  },
};
