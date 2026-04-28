const express = require("express");
const https = require("https");
const path = require("path");
const cron = require("node-cron");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const BUILD_VERSION = Date.now().toString();
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "drops.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const LOG_FILE = path.join(DATA_DIR, "errors.log");
const MEMES_PER_DROP = 20;

const SUBREDDITS = ["memes", "dankmemes", "me_irl", "wholesomememes", "shitposting"];

// Drop schedule: noon and 6pm UTC
const DROP_HOURS = [12, 18];

// Cache busting: serve sw.js with build version injected + no-cache
app.get("/sw.js", (req, res) => {
  const swContent = `
const CACHE_NAME = 'memevault-v${BUILD_VERSION}';
const ASSETS = [];

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
`;
  res.set({
    "Content-Type": "application/javascript",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  res.send(swContent);
});

// No-cache headers for HTML
app.get("/", (req, res, next) => {
  res.set({
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- Error logging ---
function logError(context, error) {
  const entry = `[${new Date().toISOString()}] [${context}] ${error?.message || error}\n`;
  console.error(entry.trim());
  try {
    fs.appendFileSync(LOG_FILE, entry);
  } catch (e) {
    console.error("Failed to write error log:", e.message);
  }
}

// --- History management ---
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    }
  } catch (e) {
    logError("loadHistory", e);
  }
  return [];
}

function saveToHistory(drop) {
  try {
    const history = loadHistory();
    // Don't duplicate
    if (history.some((d) => d.id === drop.id)) return;
    // Store summary (drop metadata + meme count, not full meme data to save space)
    history.unshift({
      id: drop.id,
      droppedAt: drop.droppedAt,
      memeCount: drop.memes.length,
      memes: drop.memes,
    });
    // Keep last 50 drops
    if (history.length > 50) history.length = 50;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (e) {
    logError("saveToHistory", e);
  }
}

// Load persisted drops
let currentDrop = null;
try {
  if (fs.existsSync(DATA_FILE)) {
    currentDrop = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
} catch (e) {
  logError("loadDrops", e);
}

// Fetch via meme-api.com (proxies Reddit, avoids IP blocks)
function fetchMemeApi(subreddit, count = 50) {
  return new Promise((resolve) => {
    const url = `https://meme-api.com/gimme/${subreddit}/${count}`;
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        logError("fetchMemeApi", `${subreddit} returned HTTP ${res.statusCode}`);
        res.resume();
        resolve([]);
        return;
      }

      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const memes = (json.memes || [])
            .filter((m) => !m.nsfw && !m.spoiler)
            .map((m) => ({
              id: m.postLink.split("/").pop(),
              title: m.title,
              url: m.url,
              subreddit: "r/" + m.subreddit,
              score: m.ups || 0,
            }));
          resolve(memes);
        } catch (e) {
          logError("fetchMemeApi:parse", `${subreddit} - ${e.message} - body starts with: ${data.slice(0, 200)}`);
          resolve([]);
        }
      });
      res.on("error", (e) => {
        logError("fetchMemeApi:stream", `${subreddit} - ${e.message}`);
        resolve([]);
      });
    }).on("error", (e) => {
      logError("fetchMemeApi:connect", `${subreddit} - ${e.message}`);
      resolve([]);
    });
  });
}

function getNextDropTime() {
  const now = new Date();
  const today = new Date(now);

  for (const hour of DROP_HOURS) {
    const dropTime = new Date(today);
    dropTime.setUTCHours(hour, 0, 0, 0);
    if (dropTime > now) return dropTime.toISOString();
  }

  // Next day's first drop
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(DROP_HOURS[0], 0, 0, 0);
  return tomorrow.toISOString();
}

function getDropId() {
  const now = new Date();
  const hour = now.getUTCHours();
  const dropHour = hour >= 18 ? 18 : hour >= 12 ? 12 : 18;
  const date = new Date(now);
  if (dropHour === 18 && hour < 12) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return `${date.toISOString().split("T")[0]}-${dropHour}`;
}

async function generateDrop() {
  console.log("Generating new meme drop...");
  const results = await Promise.all(SUBREDDITS.map((sub) => fetchMemeApi(sub, 50)));
  let all = results.flat();

  // Log per-subreddit results for debugging
  SUBREDDITS.forEach((sub, i) => {
    console.log(`  r/${sub}: ${results[i].length} memes`);
    if (results[i].length === 0) {
      logError("generateDrop", `r/${sub} returned 0 memes`);
    }
  });

  // Deduplicate by id
  const seen = new Set();
  all = all.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  // Sort by score descending, take top memes
  all.sort((a, b) => b.score - a.score);
  const memes = all.slice(0, MEMES_PER_DROP);

  // Shuffle for variety
  for (let i = memes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [memes[i], memes[j]] = [memes[j], memes[i]];
  }

  const drop = {
    id: getDropId(),
    memes,
    droppedAt: new Date().toISOString(),
    nextDrop: getNextDropTime(),
  };

  if (memes.length === 0) {
    logError("generateDrop", `Drop ${drop.id} produced 0 memes from ${all.length} total candidates`);
  }

  currentDrop = drop;
  fs.writeFileSync(DATA_FILE, JSON.stringify(drop, null, 2));
  saveToHistory(drop);
  console.log(`Drop ${drop.id} ready with ${memes.length} memes. Next drop: ${drop.nextDrop}`);
  return drop;
}

// Schedule drops at noon and 6pm UTC
cron.schedule("0 12,18 * * *", () => {
  generateDrop().catch((e) => logError("cron:generateDrop", e));
});

// API: get current drop
app.get("/api/drop", (req, res) => {
  if (!currentDrop || currentDrop.memes.length === 0) {
    return res.json({
      memes: [],
      nextDrop: getNextDropTime(),
      dropId: null,
      total: 0,
    });
  }
  res.json({
    memes: currentDrop.memes,
    nextDrop: getNextDropTime(),
    dropId: currentDrop.id,
    droppedAt: currentDrop.droppedAt,
    total: currentDrop.memes.length,
  });
});

// API: get drop history
app.get("/api/history", (req, res) => {
  const history = loadHistory();
  res.json(history);
});

// API: get a specific past drop by id
app.get("/api/history/:dropId", (req, res) => {
  const history = loadHistory();
  const drop = history.find((d) => d.id === req.params.dropId);
  if (!drop) return res.status(404).json({ error: "Drop not found" });
  res.json(drop);
});

// API: get error log (last 50 lines)
app.get("/api/errors", (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json({ errors: [] });
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.trim().split("\n").slice(-50);
    res.json({ errors: lines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Startup: generate a drop if none exists or if it's stale
async function startup() {
  const currentId = getDropId();
  if (!currentDrop || currentDrop.id !== currentId) {
    await generateDrop();
  } else {
    console.log(`Using existing drop: ${currentDrop.id} (${currentDrop.memes.length} memes)`);
    // Ensure current drop is in history
    saveToHistory(currentDrop);
  }
}

app.listen(PORT, () => {
  console.log(`memevault running on port ${PORT}`);
  startup().catch((e) => logError("startup", e));
});
