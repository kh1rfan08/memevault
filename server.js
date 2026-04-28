const express = require("express");
const https = require("https");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const SUBREDDITS = ["memes", "dankmemes", "me_irl", "wholesomememes", "shitposting"];
const CACHE_TTL = 5 * 60 * 1000;

let cache = { memes: [], timestamp: 0 };

function fetchReddit(subreddit) {
  return new Promise((resolve, reject) => {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=50`;
    https.get(url, { headers: { "User-Agent": "memevault/1.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const posts = (json.data?.children || [])
            .map((c) => c.data)
            .filter((p) => {
              const url = p.url || "";
              return (
                !p.over_18 &&
                !p.is_video &&
                (url.endsWith(".jpg") ||
                  url.endsWith(".jpeg") ||
                  url.endsWith(".png") ||
                  url.endsWith(".gif") ||
                  url.endsWith(".webp"))
              );
            })
            .map((p) => ({
              id: p.id,
              title: p.title,
              url: p.url,
              subreddit: p.subreddit_name_prefixed,
              score: p.score,
              author: p.author,
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

async function getAllMemes() {
  if (Date.now() - cache.timestamp < CACHE_TTL && cache.memes.length > 0) {
    return cache.memes;
  }
  const results = await Promise.all(SUBREDDITS.map(fetchReddit));
  const all = results.flat();
  // Shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  cache = { memes: all, timestamp: Date.now() };
  return all;
}

app.get("/api/memes", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const size = 20;
    const memes = await getAllMemes();
    const slice = memes.slice(page * size, (page + 1) * size);
    res.json({ memes: slice, total: memes.length, page });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch memes" });
  }
});

app.listen(PORT, () => {
  console.log(`memevault running on port ${PORT}`);
});
