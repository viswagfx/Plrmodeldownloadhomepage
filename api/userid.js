export default async function handler(req, res) {
  // CORS (optional but nice)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { username } = req.body || {};
    const u = String(username || "").trim();

    if (!u) return res.status(400).json({ error: "username required" });

    const r = await fetch("https://users.roproxy.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [u],
        excludeBannedUsers: false
      })
    });

    const j = await r.json().catch(() => null);

    if (!r.ok) {
      return res.status(r.status).json(j || { error: "lookup failed" });
    }

    const id = j?.data?.[0]?.id;
    if (!id) return res.status(404).json({ error: "user not found" });

    return res.status(200).json({ id });
  } catch (e) {
    return res.status(500).json({ error: "server error", details: String(e) });
  }
}