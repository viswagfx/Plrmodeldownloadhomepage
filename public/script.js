// ======================
// Elements
// ======================
const statusBox = document.getElementById("statusBox");

// Tabs
const tabCurrent = document.getElementById("tabCurrent");
const tabOutfits = document.getElementById("tabOutfits");
const sectionCurrent = document.getElementById("sectionCurrent");
const sectionOutfits = document.getElementById("sectionOutfits");

// Current Avatar
const usernameInput = document.getElementById("usernameInput");
const downloadCurrentBtn = document.getElementById("downloadCurrentBtn");

// Outfits (username)
const outfitUsernameInput = document.getElementById("outfitUsernameInput");
const loadBtn = document.getElementById("loadBtn");
const outfitsGrid = document.getElementById("outfitsGrid");

const FALLBACK_THUMB =
  "https://tr.rbxcdn.com/30DAY-AvatarHeadshot-Png/420/420/AvatarHeadshot/Png/noFilter";

// prevent spam clicks while downloading an outfit
let outfitDownloadBusy = false;

// ======================
// Helpers
// ======================
function setStatus(type, title, msg) {
  statusBox.innerHTML = `<span class="badge ${type}">${title}</span>\n${msg}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearOutfits() {
  outfitsGrid.innerHTML = "";
}

function cleanUsername(name) {
  return String(name || "").trim();
}

// ======================
// Warm-up (fix Vercel cold-start 404)
// ======================
async function warmUpOutfitApi() {
  try {
    await fetch("/api/outfit-download", { method: "OPTIONS" });
  } catch {}
}

// ======================
// Tabs
// ======================
function setTab(mode) {
  if (mode === "current") {
    tabCurrent.classList.add("active");
    tabOutfits.classList.remove("active");

    sectionCurrent.classList.remove("hidden");
    sectionOutfits.classList.add("hidden");

    setStatus("warn", "Current Avatar", "Enter a username and download their current avatar ZIP.");
  } else {
    tabOutfits.classList.add("active");
    tabCurrent.classList.remove("active");

    sectionOutfits.classList.remove("hidden");
    sectionCurrent.classList.add("hidden");

    // warm up outfit download function so first click doesn't 404
    warmUpOutfitApi();

    setStatus("warn", "Saved Outfits", "Enter a username to load outfits, then click one to download.");
  }
}

tabCurrent.addEventListener("click", () => setTab("current"));
tabOutfits.addEventListener("click", () => setTab("outfits"));

// ======================
// API: username -> userId (backend)
// ======================
async function usernameToUserId(username) {
  const r = await fetch("/api/userid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username })
  });

  if (!r.ok) {
    let msg = `Username lookup failed (HTTP ${r.status})`;
    try {
      const j = await r.json();
      msg = j?.error || j?.details || msg;
    } catch {}
    throw new Error(msg);
  }

  const j = await r.json();
  if (!j?.id) throw new Error("No userId returned for this username.");
  return String(j.id);
}

// ======================
// Current Avatar ZIP download (backend)
// ======================
async function downloadCurrentAvatarZip(username) {
  setStatus("warn", "Working", "Looking up username...");

  const userId = await usernameToUserId(username);

  setStatus("warn", "Downloading", `Building ZIP...\nUsername: ${username}\nUserId: ${userId}`);

  const r = await fetch("/api/player-download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, username })
  });

  if (!r.ok) {
    let msg = `Download failed (HTTP ${r.status})`;
    try {
      const j = await r.json();
      msg = j?.error || j?.details || msg;
    } catch {
      try {
        const t = await r.text();
        if (t) msg = t.slice(0, 200);
      } catch {}
    }
    throw new Error(msg);
  }

  const blob = await r.blob();
  const fileName = `User_${userId}_CurrentAvatar.zip`;

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  setStatus("ok", "Started", `Download started:\n${fileName}`);
}

downloadCurrentBtn.addEventListener("click", async () => {
  const username = cleanUsername(usernameInput.value);

  if (!username) {
    setStatus("err", "Error", "Enter a Roblox username.");
    return;
  }

  downloadCurrentBtn.disabled = true;
  downloadCurrentBtn.textContent = "Downloading...";

  try {
    await downloadCurrentAvatarZip(username);
  } catch (e) {
    setStatus("err", "Error", e.message);
  } finally {
    downloadCurrentBtn.disabled = false;
    downloadCurrentBtn.textContent = "Download Current Avatar ZIP";
  }
});

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") downloadCurrentBtn.click();
});

// ======================
// Outfits: load list (backend) by userId
// ======================
async function loadOutfitsByUserId(userId) {
  setStatus("warn", "Loading", "Fetching outfits list...");
  clearOutfits();

  const r = await fetch(`/api/outfits?userId=${encodeURIComponent(userId)}`);

  let j;
  try {
    j = await r.json();
  } catch {
    throw new Error("Outfits API returned non-JSON response.");
  }

  if (!r.ok) {
    throw new Error(j?.error || j?.details || `Failed to load outfits (HTTP ${r.status})`);
  }

  if (!Array.isArray(j.outfits)) {
    throw new Error("Backend response missing outfits list.");
  }

  // ✅ keep fetched visible (you wanted this)
  setStatus("ok", "Outfits Loaded", `Fetched: ${j.outfits.length}`);

  return j.outfits;
}

// ======================
// Outfits thumbnails (roproxy direct)
// ======================
async function fetchOutfitThumbnails(outfitIds) {
  const CHUNK_SIZE = 50;
  const map = new Map();

  for (let i = 0; i < outfitIds.length; i += CHUNK_SIZE) {
    const chunk = outfitIds.slice(i, i + CHUNK_SIZE);

    const url =
      `https://thumbnails.roproxy.com/v1/users/outfits` +
      `?userOutfitIds=${chunk.join(",")}` +
      `&size=420x420&format=Png&isCircular=false`;

    try {
      const r = await fetch(url);
      const j = await r.json();

      if (!Array.isArray(j.data)) continue;

      for (const item of j.data) {
        const id = String(item?.targetId ?? "");
        const state = String(item?.state ?? "").toLowerCase();

        if (!id) continue;

        if (state === "completed" && item?.imageUrl) {
          map.set(id, item.imageUrl);
        }
      }
    } catch {
      // ignore thumbnail chunk errors
    }
  }

  return map;
}

// ======================
// Outfit download ZIP (backend)
// ======================
async function downloadOutfit(outfit) {
  setStatus("warn", "Downloading", `Building ZIP...\n${outfit.name} (${outfit.id})`);

  const r = await fetch("/api/outfit-download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outfitId: outfit.id,
      outfitName: outfit.name
    })
  });

  if (!r.ok) {
    let msg = `Download failed (HTTP ${r.status})`;
    try {
      const j = await r.json();
      msg = j?.error || j?.details || msg;
    } catch {
      try {
        const t = await r.text();
        if (t) msg = t.slice(0, 200);
      } catch {}
    }
    throw new Error(msg);
  }

  const blob = await r.blob();
  const fileName = `Outfit_${outfit.id}.zip`;

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  setStatus("ok", "Started", `Download started:\n${fileName}`);
}

// ======================
// Render outfits (big square cards)
// ======================
async function renderOutfits(outfits) {
  clearOutfits();

  // keep "Fetched: X" visible
  setStatus("ok", "Outfits Loaded", `Fetched: ${outfits.length}`);

  // render instantly
  for (const outfit of outfits) {
    const btn = document.createElement("button");
    btn.className = "outfit-btn";
    btn.dataset.outfitId = outfit.id;

    btn.innerHTML = `
      <div class="outfit-thumb-wrap">
        <img class="outfit-thumb" src="${FALLBACK_THUMB}" alt="">
        <div class="outfit-loading-overlay">
          <div class="spinner"></div>
        </div>
      </div>

      <div>
        <div class="outfit-name">${escapeHtml(outfit.name)}</div>
        <div class="outfit-id">ID: ${escapeHtml(outfit.id)}</div>
      </div>
    `;

    btn.addEventListener("click", async () => {
      if (outfitDownloadBusy) return;
      outfitDownloadBusy = true;

      const allBtns = outfitsGrid.querySelectorAll("button.outfit-btn");
      allBtns.forEach((b) => (b.disabled = true));

      btn.classList.add("is-loading");

      try {
        await downloadOutfit(outfit);
      } catch (e) {
        setStatus("err", "Error", e.message);
      } finally {
        btn.classList.remove("is-loading");
        allBtns.forEach((b) => (b.disabled = false));
        outfitDownloadBusy = false;
      }
    });

    outfitsGrid.appendChild(btn);
  }

  // thumbnails
  setStatus("warn", "Thumbnails", `Loading thumbnails...\nOutfits: ${outfits.length}`);
  const ids = outfits.map((o) => String(o.id));
  const thumbMap = await fetchOutfitThumbnails(ids);

  const buttons = outfitsGrid.querySelectorAll("button.outfit-btn");
  buttons.forEach((btn) => {
    const id = String(btn.dataset.outfitId);
    const url = thumbMap.get(id);

    if (url) {
      const img = btn.querySelector("img.outfit-thumb");
      if (img) img.src = url;
    }
  });

  setStatus("ok", "Ready", `Outfits ready: ${outfits.length}`);
}


// ======================
// Load outfits button (username -> userId -> outfits)
// ======================
loadBtn.addEventListener("click", async () => {
  const username = cleanUsername(outfitUsernameInput.value);

  if (!username) {
    setStatus("err", "Error", "Enter a Roblox username.");
    return;
  }

  loadBtn.disabled = true;
  loadBtn.textContent = "Loading...";

  try {
    setStatus("warn", "Working", "Looking up username...");
    const userId = await usernameToUserId(username);

    const outfits = await loadOutfitsByUserId(userId);
    await renderOutfits(outfits);
  } catch (e) {
    setStatus("err", "Error", e.message);
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = "Load Outfits";
  }
});

outfitUsernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadBtn.click();
});

// ======================
// Init
// ======================
setTab("current");
