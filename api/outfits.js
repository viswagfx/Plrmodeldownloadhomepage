const cache = globalThis.__outfitsCache || new Map();
globalThis.__outfitsCache = cache;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const r = await fetch(url);
    const raw = await r.text();

    if (r.status === 429) {
      const wait = 1000 * (attempt + 1);
      await sleep(wait);
      continue;
    }

    let j;
    try {
      j = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        status: 502,
        json: { error: "roproxy returned non-JSON", raw: raw.slice(0, 200) }
      };
    }

    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        json: { error: "roproxy error", status: r.status, data: j }
      };
    }

    return { ok: true, status: 200, json: j };
  }

  return {
    ok: false,
    status: 429,
    json: { error: "Rate limited (429). Try again in a few seconds." }
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const userId = String(req.query.userId || "").trim().replace(/\s+/g, "");
  if (!/^\d+$/.test(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  const key = `outfits:${userId}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < 60_000) {
    return res.status(200).json(cached.data);
  }

  try {
    const url = `https://avatar.roproxy.com/v2/avatar/users/${userId}/outfits?page=1&itemsPerPage=999&isEditable=true`;

    const result = await fetchJsonWithRetry(url, 5);
    if (!result.ok) return res.status(result.status).json(result.json);

    const j = result.json;

    const outfits = (j.data || []).map((o) => ({
      id: o.id,
      name: o.name || "Unnamed Outfit"
    }));

    const response = {
      userId,
      total: j.total ?? outfits.length,
      fetched: outfits.length,
      outfits
    };

    cache.set(key, { time: Date.now(), data: response });

    return res.status(200).json(response);
  } catch (e) {
    return res.status(500).json({ error: "server error", details: String(e) });
  }
}
