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
const VOTES_FILE = path.join(DATA_DIR, "votes.json");
const LOG_FILE = path.join(DATA_DIR, "errors.log");
const MEMES_PER_DROP = 20;

// High-signal humor subreddits (visual memes, absurd humor, creative content)
const SUBREDDITS = [
  "memes",
  "dankmemes",
  "comedyheaven",
  "blursedimages",
  "me_irl",
  "whenthe",
  "antimeme",
  "surrealmemes",
  "programmerhumor",
  "memeeconomy",
];

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

app.use(express.json());
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

// --- Vote management ---
function loadVotes() {
  try {
    if (fs.existsSync(VOTES_FILE)) {
      return JSON.parse(fs.readFileSync(VOTES_FILE, "utf8"));
    }
  } catch (e) {
    logError("loadVotes", e);
  }
  return {};
}

function saveVote(memeId, payload) {
  try {
    const votes = loadVotes();
    if (payload === null) {
      delete votes[memeId];
    } else {
      votes[memeId] = payload;
    }
    fs.writeFileSync(VOTES_FILE, JSON.stringify(votes, null, 2));
  } catch (e) {
    logError("saveVote", e);
  }
}

function computeSubStats(votes) {
  const stats = {};
  for (const v of Object.values(votes)) {
    const sub = v.subreddit;
    if (!sub) continue;
    if (!stats[sub]) stats[sub] = { up: 0, down: 0 };
    if (v.vote === "up") stats[sub].up++;
    else if (v.vote === "down") stats[sub].down++;
  }
  return stats;
}

// Weight subreddits by historical vote ratio. New subs (or low data) stay at 1.0.
// Strong likes nudge weight up to 2.0, dislikes down to 0.4.
function getSubredditWeights() {
  const stats = computeSubStats(loadVotes());
  const weights = {};
  for (const sub of SUBREDDITS) {
    const s = stats["r/" + sub] || { up: 0, down: 0 };
    const total = s.up + s.down;
    if (total < 5) {
      weights[sub] = 1.0;
    } else {
      const ratio = s.up / total;
      weights[sub] = Math.max(0.4, Math.min(2.0, 0.4 + ratio * 1.6));
    }
  }
  return weights;
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
  const weights = getSubredditWeights();
  const fetchCounts = SUBREDDITS.map((sub) => Math.max(10, Math.round(50 * weights[sub])));
  const results = await Promise.all(
    SUBREDDITS.map((sub, i) => fetchMemeApi(sub, fetchCounts[i]))
  );
  let all = results.flat();

  // Log per-subreddit results for debugging
  SUBREDDITS.forEach((sub, i) => {
    console.log(`  r/${sub}: ${results[i].length} memes (weight ${weights[sub].toFixed(2)}, fetched ${fetchCounts[i]})`);
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

  // Exclude memes that appeared in previous drops
  const history = loadHistory();
  const pastMemeIds = new Set();
  for (const drop of history) {
    if (drop.memes) {
      for (const m of drop.memes) {
        pastMemeIds.add(m.id);
      }
    }
  }
  all = all.filter((m) => !pastMemeIds.has(m.id));
  console.log(`  After excluding past drops: ${all.length} unique memes remaining`);

  // Content filter: remove text screenshots, social media reposts, and edgy/offensive content
  const FILTER_TITLE_RE = /\b(tweet|twitter|snapchat|text message|group chat|facebook|instagram post|tiktok|discord|ratio|cope|seethe|slur|n.word|retard|kill yourself|kys)\b/i;
  const FILTER_URL_RE = /\.(gif)$/i; // skip gifs (often low quality/loading issues)
  all = all.filter((m) => !FILTER_TITLE_RE.test(m.title) && !FILTER_URL_RE.test(m.url));
  console.log(`  After content filter: ${all.length} memes`);

  // Threshold + random sampling (instead of top-N by upvotes)
  const MIN_SCORE = 500;
  let pool = all.filter((m) => m.score >= MIN_SCORE);
  // If not enough qualify, relax threshold progressively
  if (pool.length < MEMES_PER_DROP) {
    pool = all.filter((m) => m.score >= 200);
  }
  if (pool.length < MEMES_PER_DROP) {
    pool = all; // use everything we have
  }
  console.log(`  Qualified pool: ${pool.length} memes (threshold applied)`);

  // Shuffle the pool randomly
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Pick with subreddit diversity — max 4 per subreddit
  const MAX_PER_SUB = 4;
  const subCounts = {};
  const memes = [];
  for (const m of pool) {
    if (memes.length >= MEMES_PER_DROP) break;
    const count = subCounts[m.subreddit] || 0;
    if (count >= MAX_PER_SUB) continue;
    memes.push(m);
    subCounts[m.subreddit] = count + 1;
  }
  // If we didn't fill up (unlikely), grab remaining without limit
  if (memes.length < MEMES_PER_DROP) {
    const picked = new Set(memes.map((m) => m.id));
    for (const m of pool) {
      if (memes.length >= MEMES_PER_DROP) break;
      if (!picked.has(m.id)) memes.push(m);
    }
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
  res.set({ "Cache-Control": "no-cache, no-store, must-revalidate" });
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

// API: cast or clear a vote on a meme
app.post("/api/vote", (req, res) => {
  const { memeId, vote, dropId, title, subreddit, url, score } = req.body || {};
  if (!memeId) return res.status(400).json({ error: "memeId required" });
  if (vote !== null && vote !== "up" && vote !== "down") {
    return res.status(400).json({ error: "vote must be 'up', 'down', or null" });
  }
  if (vote === null) {
    saveVote(memeId, null);
  } else {
    saveVote(memeId, {
      vote,
      dropId: dropId || null,
      title: title || "",
      subreddit: subreddit || "",
      url: url || "",
      score: typeof score === "number" ? score : 0,
      votedAt: new Date().toISOString(),
    });
  }
  res.json({ ok: true });
});

// API: get all votes (so client can hydrate UI state)
app.get("/api/votes", (req, res) => {
  res.set({ "Cache-Control": "no-cache, no-store, must-revalidate" });
  res.json(loadVotes());
});

// API: aggregated stats
app.get("/api/stats", (req, res) => {
  res.set({ "Cache-Control": "no-cache, no-store, must-revalidate" });
  const votes = loadVotes();
  let totalUp = 0, totalDown = 0;
  const subStats = computeSubStats(votes);
  for (const s of Object.values(subStats)) {
    totalUp += s.up;
    totalDown += s.down;
  }
  const subreddits = Object.entries(subStats)
    .map(([sub, s]) => {
      const total = s.up + s.down;
      return {
        subreddit: sub,
        up: s.up,
        down: s.down,
        total,
        ratio: total > 0 ? s.up / total : 0,
      };
    })
    .sort((a, b) => b.ratio - a.ratio || b.total - a.total);
  res.json({
    totalUp,
    totalDown,
    totalVotes: totalUp + totalDown,
    subreddits,
  });
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
