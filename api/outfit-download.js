import JSZip from "jszip";

function getHashUrl(hash, type = "t") {
  let st = 31;
  for (let ii = 0; ii < hash.length; ii++) st ^= hash[ii].charCodeAt(0);
  return `https://${type}${(st % 8).toString()}.rbxcdn.com/${hash}`;
}

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

async function fetchArrayBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.arrayBuffer();
}

function safeFileName(name) {
  return String(name || "Outfit").replace(/[^a-z0-9]/gi, "_").slice(0, 60);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const outfitId = String(req.body?.outfitId || "").trim();
    const outfitName = String(req.body?.outfitName || "Outfit").trim();

    if (!/^\d+$/.test(outfitId)) {
      return res.status(400).json({ error: "Invalid outfitId" });
    }

    // 1) Get 3D data
    const thumbUrl = `https://thumbnails.roproxy.com/v1/users/outfit-3d?outfitId=${outfitId}`;
    const thumbJson = JSON.parse(await fetchText(thumbUrl));

    let entry = null;
    if (Array.isArray(thumbJson.data) && thumbJson.data.length) entry = thumbJson.data[0];
    else if (thumbJson.imageUrl) entry = thumbJson;

    if (!entry?.imageUrl) {
      return res.status(404).json({ error: "No 3D data available for this outfit" });
    }

    const imageJson = JSON.parse(await fetchText(entry.imageUrl));
    const { obj, mtl, textures } = imageJson;

    if (!obj && !mtl && !textures) {
      return res.status(500).json({ error: "3D JSON missing obj/mtl/textures" });
    }

    // 2) Build zip
    const zip = new JSZip();
    const baseName = `Outfit_${outfitId}_${safeFileName(outfitName)}`;

    // MTL + textures
    if (mtl) {
      const mtlText = await fetchText(getHashUrl(mtl));
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
        const ab = await fetchArrayBuffer(t.url);
        zip.file(t.filename, ab);
      }
    }

    // OBJ
    if (obj) {
      const objText = await fetchText(getHashUrl(obj));
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
