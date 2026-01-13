export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function fetchJsonWithRetry(url, options, tries = 5) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const r = await fetch(url, options).catch(() => null);

      if (!r) {
        await sleep(400 * (attempt + 1));
        continue;
      }

      if (r.status === 429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      const raw = await r.text();
      let j = null;

      try {
        j = JSON.parse(raw);
      } catch {
        return {
          ok: false,
          status: 502,
          json: { error: "proxy returned non-JSON", raw: raw.slice(0, 200) }
        };
      }

      if (!r.ok) {
        return {
          ok: false,
          status: r.status,
          json: j || { error: "lookup failed" }
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

  try {
    const { username } = req.body || {};
    const u = String(username || "").trim();

    if (!u) return res.status(400).json({ error: "username required" });

    const result = await fetchJsonWithRetry(
      "https://users.roproxy.com/v1/usernames/users",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usernames: [u],
          excludeBannedUsers: false
        })
      },
      5
    );

    if (!result.ok) return res.status(result.status).json(result.json);

    const id = result.json?.data?.[0]?.id;
    if (!id) return res.status(404).json({ error: "user not found" });

    return res.status(200).json({ id });
  } catch (e) {
    return res.status(500).json({ error: "server error", details: String(e) });
  }
}
