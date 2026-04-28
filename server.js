const express = require("express");
const https = require("https");
const path = require("path");
const cron = require("node-cron");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "drops.json");
const MEMES_PER_DROP = 20;

const SUBREDDITS = ["memes", "dankmemes", "me_irl", "wholesomememes", "shitposting"];

// Drop schedule: noon and 6pm UTC
const DROP_HOURS = [12, 18];

app.use(express.static(path.join(__dirname, "public")));

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
}

// Load persisted drops
let currentDrop = null;
try {
  if (fs.existsSync(DATA_FILE)) {
    currentDrop = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
} catch (e) {
  console.error("Failed to load drops:", e.message);
}

function fetchReddit(subreddit) {
  return new Promise((resolve) => {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=50`;
    https.get(url, { headers: { "User-Agent": "memevault/2.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const posts = (json.data?.children || [])
            .map((c) => c.data)
            .filter((p) => {
              const u = p.url || "";
              return (
                !p.over_18 &&
                !p.is_video &&
                !p.stickied &&
                p.score > 500 &&
                (u.endsWith(".jpg") ||
                  u.endsWith(".jpeg") ||
                  u.endsWith(".png") ||
                  u.endsWith(".gif") ||
                  u.endsWith(".webp"))
              );
            })
            .map((p) => ({
              id: p.id,
              title: p.title,
              url: p.url,
              subreddit: p.subreddit_name_prefixed,
              score: p.score,
            }));
          resolve(posts);
        } catch (e) {
          resolve([]);
        }
      });
      res.on("error", () => resolve([]));
    }).on("error", () => resolve([]));
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
  const results = await Promise.all(SUBREDDITS.map(fetchReddit));
  let all = results.flat();

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

  currentDrop = drop;
  fs.writeFileSync(DATA_FILE, JSON.stringify(drop, null, 2));
  console.log(`Drop ${drop.id} ready with ${memes.length} memes. Next drop: ${drop.nextDrop}`);
  return drop;
}

// Schedule drops at noon and 6pm UTC
cron.schedule("0 12,18 * * *", () => {
  generateDrop().catch((e) => console.error("Drop generation failed:", e));
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

// Startup: generate a drop if none exists or if it's stale
async function startup() {
  const currentId = getDropId();
  if (!currentDrop || currentDrop.id !== currentId) {
    await generateDrop();
  } else {
    console.log(`Using existing drop: ${currentDrop.id} (${currentDrop.memes.length} memes)`);
  }
}

app.listen(PORT, () => {
  console.log(`memevault running on port ${PORT}`);
  startup().catch((e) => console.error("Startup drop failed:", e));
});
