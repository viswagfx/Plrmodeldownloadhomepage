import JSZip from "jszip";
import { checkRateLimit, getIp } from "./lib/rate-limit.js";

function getHashUrl(hash, type = "t") {
  let st = 31;
  for (let ii = 0; ii < hash.length; ii++) st ^= hash[ii].charCodeAt(0);
  return `https://${type}${(st % 8).toString()}.rbxcdn.com/${hash}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTextWithRetry(url, getOptions = {}) {
  const tries = 5;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const r = await fetch(url, getOptions);

      if (r.status === 429) {
        await sleep(800 * (attempt + 1));
        continue;
      }

      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);

      return await r.text();
    } catch (e) {
      if (attempt === tries - 1) throw e;
      await sleep(350 * (attempt + 1));
    }
  }
}

async function fetchArrayBufferWithRetry(url, getOptions = {}) {
  const tries = 5;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const r = await fetch(url, getOptions);

      if (r.status === 429) {
        await sleep(800 * (attempt + 1));
        continue;
      }

      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);

      return await r.arrayBuffer();
    } catch (e) {
      if (attempt === tries - 1) throw e;
      await sleep(350 * (attempt + 1));
    }
  }
}

function safeFileName(name) {
  return String(name || "User").replace(/[^a-z0-9]/gi, "_").slice(0, 60);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Rate Limit Check
  if (!checkRateLimit(req)) {
    return res.status(429).json({ error: "Too many requests. Please try again in a minute." });
  }

  // Forward User IP
  let clientIp = "unknown";
  try {
    clientIp = getIp(req);
  } catch (e) {
    console.error("Failed to get IP:", e);
  }

  const forwardHeaders = {
    headers: {
      "X-Forwarded-For": clientIp,
      "Roblox-Id": "true"
    }
  };

  try {
    const userId = String(req.body?.userId || "").trim();
    const username = String(req.body?.username || "User").trim();

    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    // 1) Get 3D data for USER AVATAR
    const thumbUrl = `https://thumbnails.roproxy.com/v1/users/avatar-3d?userId=${userId}`;
    const thumbJson = JSON.parse(await fetchTextWithRetry(thumbUrl, forwardHeaders));

    let entry = null;
    if (Array.isArray(thumbJson.data) && thumbJson.data.length) entry = thumbJson.data[0];
    else if (thumbJson.imageUrl || thumbJson.targetId) entry = thumbJson;

    if (!entry?.imageUrl) {
      return res.status(404).json({ error: "No 3D data available for this user" });
    }

    const imageJson = JSON.parse(await fetchTextWithRetry(entry.imageUrl, forwardHeaders));
    const { obj, mtl, textures } = imageJson;

    if (!obj && !mtl && !textures) {
      return res.status(500).json({ error: "3D JSON missing obj/mtl/textures" });
    }

    // 2) Build zip
    const zip = new JSZip();
    const baseName = `User_${userId}_${safeFileName(username)}`;

    // MTL + textures
    if (mtl) {
      const mtlText = await fetchTextWithRetry(getHashUrl(mtl), forwardHeaders);
      const textureFiles = Array.isArray(textures) ? textures : [];

      let replacedMtl = mtlText;
      const texEntries = [];

      for (let i = 0; i < textureFiles.length; i++) {
        const texHash = textureFiles[i];
        const filename = `texture_${i + 1}.png`;

        replacedMtl = replacedMtl.replace(new RegExp(texHash, "g"), filename);
        texEntries.push({ url: getHashUrl(texHash), filename });
      }

      zip.file(`${baseName}.mtl`, replacedMtl);

      for (const t of texEntries) {
        const ab = await fetchArrayBufferWithRetry(t.url, forwardHeaders);
        zip.file(t.filename, ab);
      }
    }

    // OBJ
    if (obj) {
      const objText = await fetchTextWithRetry(getHashUrl(obj), forwardHeaders);
      zip.file(`${baseName}.obj`, objText);
    }

    // Meta
    zip.file(`${baseName}_meta.json`, JSON.stringify(imageJson, null, 2));

    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });

    // 3) Return zip
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}.zip"`);
    return res.status(200).send(zipBuf);
  } catch (e) {
    return res.status(500).json({ error: "Download failed", details: String(e) });
  }
}
