/* ============================================================
   Clearwrite — Cloudflare Worker proxy.

   Two paths:
     • generate — {address, facts} → Geocode + Google Places (neutral,
       compliance-filtered) → Claude (Opus) writes a short compliant description.
     • rewrite  — {text} → Claude (Sonnet) rewrites a pasted listing compliantly.

   Keys live ONLY here (encrypted secrets), never in the page:
     npx wrangler secret put ANTHROPIC_API_KEY
     npx wrangler secret put GOOGLE_MAPS_API_KEY   # Geocoding API + Places API (New)
   ============================================================ */

// There is no "Opus 4.6" — claude-opus-4-8 is the current Opus. Change here if needed.
const MODEL_GENERATE = "claude-opus-4-8";
const MODEL_REWRITE  = "claude-sonnet-4-6";

const REWRITE_SYSTEM =
  "You are a Fair Housing compliance editor for U.S. real estate listings. " +
  "Rewrite the listing to comply with the federal Fair Housing Act (42 U.S.C. 3604(c)): " +
  "describe the property and its features, never the type of person who would live there. " +
  "Remove any language implying a preference, limitation, or discrimination based on race, color, " +
  "religion, sex, disability, familial status, or national origin. Preserve every factual detail " +
  "(beds, baths, square footage, real features). Keep it engaging and natural, about 170-210 words. " +
  "Return ONLY the rewritten listing text — no preamble, no notes, no quotation marks.";

const GENERATE_SYSTEM =
  "You are a Fair Housing compliance copywriter for U.S. real estate listings. " +
  "Write a concise, engaging listing description (about 90-120 words) from the property facts and " +
  "neutral neighborhood context provided. Describe the property and factual nearby features only — " +
  "never the type of person who would live there. Do NOT mention or imply race, color, religion, sex, " +
  "disability, familial status, or national origin, and avoid steering or coded terms (e.g. 'safe', " +
  "'exclusive', 'family-friendly', 'walking distance', school-quality claims, or places of worship). " +
  "Use factual distances when provided. Mention the neighborhood/area name only if it is purely geographic. " +
  "Return ONLY the description text — no preamble, no notes, no quotation marks.";

const ALLOWED_ORIGINS = [
  "https://harrypotter696969.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const MAX_INPUT_CHARS = 8000;

// Categories we ASK Google for — all Fair-Housing-neutral.
const NEARBY_TYPES = [
  "park", "transit_station", "supermarket", "grocery_store",
  "restaurant", "cafe", "gym", "library", "pharmacy", "shopping_mall",
];
// Defensive deny-list: drop anything that slips through with these types.
const BLOCKED_TYPES = new Set([
  "place_of_worship", "church", "mosque", "synagogue", "hindu_temple",
  "school", "primary_school", "secondary_school", "preschool", "university",
  "cemetery", "funeral_home",
]);

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

function haversineMiles(aLat, aLng, bLat, bLng) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function humanType(t) {
  return (t || "place").replace(/_/g, " ");
}

async function geocode(address, key) {
  const url = "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(address) + "&key=" + key;
  const r = await fetch(url);
  const d = await r.json().catch(() => null);
  if (!d || d.status !== "OK" || !d.results || !d.results.length) return null;
  const top = d.results[0];
  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    formatted: top.formatted_address,
  };
}

async function nearbyContext(lat, lng, key) {
  // Places API (New) — Nearby Search, ranked by distance.
  const r = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.location,places.primaryType,places.types",
    },
    body: JSON.stringify({
      includedTypes: NEARBY_TYPES,
      maxResultCount: 20,
      rankPreference: "DISTANCE",
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 4000 } },
    }),
  });
  const d = await r.json().catch(() => null);
  if (!d || !Array.isArray(d.places)) return [];

  const seenTypes = new Set();
  const items = [];
  for (const p of d.places) {
    const types = p.types || [];
    if (types.some(t => BLOCKED_TYPES.has(t))) continue;          // defensive filter
    const primary = p.primaryType || types[0] || "place";
    if (seenTypes.has(primary)) continue;                          // one per category, for variety
    if (!p.location || !p.displayName) continue;
    const miles = haversineMiles(lat, lng, p.location.latitude, p.location.longitude);
    items.push({ name: p.displayName.text, type: humanType(primary), miles });
    seenTypes.add(primary);
    if (items.length >= 7) break;
  }
  items.sort((a, b) => a.miles - b.miles);
  return items;
}

async function callClaude(model, system, userText, key) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: model === MODEL_GENERATE ? 400 : 1000,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });
  return r;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get("Origin") || "");

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500, cors);

    let payload;
    try { payload = await request.json(); }
    catch { return json({ error: "Invalid JSON body" }, 400, cors); }

    const mode = payload && payload.mode === "rewrite" ? "rewrite" : "generate";

    try {
      if (mode === "rewrite") {
        const text = (payload.text || "").toString().trim();
        if (!text) return json({ error: "Missing 'text'" }, 400, cors);
        if (text.length > MAX_INPUT_CHARS) return json({ error: "Listing too long" }, 413, cors);

        const aRes = await callClaude(MODEL_REWRITE, REWRITE_SYSTEM, text, env.ANTHROPIC_API_KEY);
        const data = await aRes.json().catch(() => null);
        if (!aRes.ok) {
          const msg = (data && data.error && data.error.message) || ("Anthropic HTTP " + aRes.status);
          return json({ error: msg }, aRes.status, cors);
        }
        return json(data, 200, cors);
      }

      // ---- generate ----
      const facts = (payload.facts || "").toString().trim();
      const address = (payload.address || "").toString().trim();
      if (!facts) return json({ error: "Missing 'facts'" }, 400, cors);
      if (facts.length > MAX_INPUT_CHARS) return json({ error: "Facts too long" }, 413, cors);

      // Live Google Maps lookup (graceful: skip if no key / geocode fails).
      let locationLine = address ? `Address: ${address}` : "";
      let nearby = [];
      if (address && env.GOOGLE_MAPS_API_KEY) {
        const geo = await geocode(address, env.GOOGLE_MAPS_API_KEY);
        if (geo) {
          locationLine = `Address: ${geo.formatted}`;
          nearby = await nearbyContext(geo.lat, geo.lng, env.GOOGLE_MAPS_API_KEY);
        }
      }

      const nearbyText = nearby.length
        ? "Neutral nearby places (straight-line distance):\n" +
          nearby.map(n => `- ${n.name} (${n.type}, ~${n.miles.toFixed(1)} mi)`).join("\n")
        : "No neighborhood data available — write from the property facts only.";

      const userText =
        `Property facts:\n${facts}\n\n` +
        (locationLine ? locationLine + "\n" : "") +
        nearbyText;

      const aRes = await callClaude(MODEL_GENERATE, GENERATE_SYSTEM, userText, env.ANTHROPIC_API_KEY);
      const data = await aRes.json().catch(() => null);
      if (!aRes.ok) {
        const msg = (data && data.error && data.error.message) || ("Anthropic HTTP " + aRes.status);
        return json({ error: msg }, aRes.status, cors);
      }
      return json(data, 200, cors);
    } catch (e) {
      return json({ error: "Upstream request failed: " + (e && e.message) }, 502, cors);
    }
  },
};
