(() => {
  const stack = document.getElementById("card-stack");
  const loader = document.getElementById("loader");
  const hint = document.getElementById("swipe-hint");
  const counter = document.getElementById("counter");
  const endScreen = document.getElementById("end-screen");
  const waitingScreen = document.getElementById("waiting-screen");
  const countdownEl = document.getElementById("countdown");
  const countdownWaiting = document.getElementById("countdown-waiting");
  const dropBadge = document.getElementById("drop-badge");

  // Vault elements
  const vaultBtn = document.getElementById("vault-btn");
  const vaultScreen = document.getElementById("vault-screen");
  const vaultBack = document.getElementById("vault-back");
  const vaultList = document.getElementById("vault-list");
  const vaultDetail = document.getElementById("vault-detail");
  const vaultDetailBack = document.getElementById("vault-detail-back");
  const vaultDetailTitle = document.getElementById("vault-detail-title");
  const vaultGrid = document.getElementById("vault-grid");

  // Vote / stats elements
  const voteBar = document.getElementById("vote-bar");
  const voteUpBtn = document.getElementById("vote-up");
  const voteDownBtn = document.getElementById("vote-down");
  const statsBtn = document.getElementById("stats-btn");
  const statsScreen = document.getElementById("stats-screen");
  const statsBack = document.getElementById("stats-back");
  const statsBody = document.getElementById("stats-body");

  let memes = [];
  let currentIndex = 0;
  let nextDropTime = null;
  let countdownInterval = null;
  let hintDismissed = false;
  let currentDropId = null;
  let voteState = {}; // memeId -> 'up' | 'down'

  async function fetchDrop() {
    try {
      const res = await fetch("/api/drop?t=" + Date.now());
      return await res.json();
    } catch (e) {
      console.error("fetch failed", e);
      return { memes: [], nextDrop: null };
    }
  }

  function formatCountdown(ms) {
    if (ms <= 0) return "00:00:00";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      if (!nextDropTime) return;
      const remaining = new Date(nextDropTime) - Date.now();
      const formatted = formatCountdown(remaining);
      if (countdownEl) countdownEl.textContent = formatted;
      if (countdownWaiting) countdownWaiting.textContent = formatted;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        setTimeout(() => location.reload(), 2000);
      }
    }, 1000);
  }

  function formatScore(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function updateCounter() {
    if (memes.length === 0) {
      counter.textContent = "";
      return;
    }
    counter.textContent = `${currentIndex + 1} / ${memes.length}`;
  }

  function showEndScreen() {
    stack.innerHTML = "";
    counter.textContent = "";
    hint.classList.add("hidden");
    voteBar.classList.add("hidden");
    endScreen.classList.remove("hidden");
    startCountdown();
  }

  function showWaitingScreen() {
    stack.innerHTML = "";
    counter.textContent = "";
    hint.classList.add("hidden");
    voteBar.classList.add("hidden");
    waitingScreen.classList.remove("hidden");
    startCountdown();
  }

  function updateVoteButtons() {
    const meme = memes[currentIndex];
    if (!meme) {
      voteBar.classList.add("hidden");
      return;
    }
    voteBar.classList.remove("hidden");
    const v = voteState[meme.id];
    voteUpBtn.classList.toggle("active", v === "up");
    voteDownBtn.classList.toggle("active", v === "down");
  }

  function clearVoteButtons() {
    voteUpBtn.classList.remove("active");
    voteDownBtn.classList.remove("active");
  }

  async function castVote(memeId, newVote) {
    const meme = memes.find((m) => m.id === memeId);
    if (!meme) return;

    // Toggle: tapping the same vote clears it
    let payload;
    if (voteState[memeId] === newVote) {
      delete voteState[memeId];
      payload = { memeId, vote: null };
    } else {
      voteState[memeId] = newVote;
      payload = {
        memeId,
        vote: newVote,
        dropId: currentDropId,
        title: meme.title,
        subreddit: meme.subreddit,
        url: meme.url,
        score: meme.score,
      };
    }
    updateVoteButtons();
    try {
      await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("vote failed", e);
    }
  }

  function renderCards() {
    stack.innerHTML = "";

    if (currentIndex >= memes.length) {
      showEndScreen();
      return;
    }

    updateCounter();
    updateVoteButtons();

    const visible = memes.slice(currentIndex, currentIndex + 3);
    visible.forEach((meme, i) => {
      const card = document.createElement("div");
      card.className = "meme-card";
      card.dataset.index = i;
      card.innerHTML = `
        <div class="card-image-wrap">
          <img src="${meme.url}" alt="" loading="${i === 0 ? "eager" : "lazy"}" draggable="false" />
        </div>
        <div class="card-info">
          <div class="card-title">${escapeHtml(meme.title)}</div>
          <div class="card-meta">
            <span>${meme.subreddit}</span>
            <span class="score">${formatScore(meme.score)}</span>
          </div>
        </div>
      `;
      stack.appendChild(card);

      if (i === 0) setupSwipe(card);
    });
  }

  function setupSwipe(card) {
    let startX = 0;
    let currentX = 0;
    let isDragging = false;

    function onStart(e) {
      isDragging = true;
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      card.classList.add("swiping");

      if (!hintDismissed) {
        hintDismissed = true;
        hint.classList.add("hidden");
      }
    }

    function onMove(e) {
      if (!isDragging) return;
      currentX = (e.touches ? e.touches[0].clientX : e.clientX) - startX;
      const rotation = currentX * 0.04;
      const opacity = 1 - Math.min(Math.abs(currentX) / 400, 0.3);
      card.style.transform = `translateX(${currentX}px) rotate(${rotation}deg)`;
      card.style.opacity = opacity;
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;
      card.classList.remove("swiping");

      const threshold = window.innerWidth * 0.2;

      if (Math.abs(currentX) > threshold) {
        if (currentX < 0) {
          // Swipe left → next: card flies off left
          clearVoteButtons();
          card.classList.add("fly-out");
          card.style.transform = `translateX(${-window.innerWidth * 1.5}px) rotate(-20deg)`;
          card.style.opacity = "0";
          setTimeout(() => {
            currentIndex++;
            renderCards();
          }, 350);
        } else if (currentIndex > 0) {
          // Swipe right → previous: snap back, then re-render at prev index
          clearVoteButtons();
          card.style.transform = "";
          card.style.opacity = "";
          setTimeout(() => {
            currentIndex--;
            renderCards();
          }, 100);
        } else {
          card.style.transform = "";
          card.style.opacity = "";
        }
      } else {
        card.style.transform = "";
        card.style.opacity = "";
      }
      currentX = 0;
    }

    card.addEventListener("touchstart", onStart, { passive: true });
    card.addEventListener("touchmove", onMove, { passive: true });
    card.addEventListener("touchend", onEnd);
    card.addEventListener("mousedown", onStart);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
  }

  // Keyboard navigation: → next, ← previous
  document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Don't hijack keys when overlays are open
    if (!vaultScreen.classList.contains("hidden")) return;
    if (!vaultDetail.classList.contains("hidden")) return;
    if (!statsScreen.classList.contains("hidden")) return;
    if (!swipeModeScreen.classList.contains("hidden")) return;

    if (e.key === "ArrowRight") {
      if (currentIndex >= memes.length) return;
      const topCard = stack.querySelector('.meme-card[data-index="0"]');
      if (!topCard) return;
      clearVoteButtons();
      topCard.classList.add("fly-out");
      topCard.style.transform = `translateX(${-window.innerWidth * 1.5}px) rotate(-20deg)`;
      topCard.style.opacity = "0";
      setTimeout(() => {
        currentIndex++;
        renderCards();
      }, 350);
    } else {
      if (currentIndex <= 0) return;
      clearVoteButtons();
      currentIndex--;
      renderCards();
    }
  });

  // --- History Vault ---
  function formatDropDate(isoStr) {
    const d = new Date(isoStr);
    const opts = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    return d.toLocaleDateString("en-US", opts);
  }

  function formatDropId(id) {
    // "2026-04-28-12" → "Apr 28 · noon drop"
    const parts = id.split("-");
    if (parts.length < 4) return id;
    const d = new Date(`${parts[0]}-${parts[1]}-${parts[2]}T00:00:00Z`);
    const month = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const hour = parseInt(parts[3]);
    const label = hour === 12 ? "noon drop" : hour === 18 ? "evening drop" : `${hour}:00 drop`;
    return `${month} · ${label}`;
  }

  async function openVault() {
    vaultScreen.classList.remove("hidden");
    vaultList.innerHTML = '<div class="vault-empty"><div class="spinner"></div><p>loading...</p></div>';

    try {
      const res = await fetch("/api/history");
      const history = await res.json();

      if (history.length === 0) {
        vaultList.innerHTML = '<div class="vault-empty"><p>no drops yet</p></div>';
        return;
      }

      vaultList.innerHTML = "";
      history.forEach((drop) => {
        const item = document.createElement("div");
        item.className = "vault-item";
        item.innerHTML = `
          <div class="vault-item-left">
            <div class="vault-item-id">${formatDropId(drop.id)}</div>
            <div class="vault-item-meta">${formatDropDate(drop.droppedAt)}</div>
          </div>
          <div class="vault-item-count">${drop.memeCount} memes</div>
        `;
        item.addEventListener("click", () => openDropDetail(drop));
        vaultList.appendChild(item);
      });
    } catch (e) {
      vaultList.innerHTML = '<div class="vault-empty"><p>failed to load history</p></div>';
    }
  }

  function openDropDetail(drop) {
    vaultScreen.classList.add("hidden");
    vaultDetail.classList.remove("hidden");
    const title = formatDropId(drop.id);
    vaultDetailTitle.textContent = title;
    vaultGrid.innerHTML = "";

    currentDropMemes = drop.memes || [];
    currentDropTitle = title;

    if (!drop.memes || drop.memes.length === 0) {
      vaultGrid.innerHTML = '<div class="vault-empty"><p>no memes in this drop</p></div>';
      return;
    }

    drop.memes.forEach((meme, idx) => {
      const el = document.createElement("div");
      el.className = "vault-meme";
      el.innerHTML = `
        <img src="${meme.url}" alt="" loading="lazy" />
        <div class="vault-meme-info">
          <div class="vault-meme-title">${escapeHtml(meme.title)}</div>
          <div class="vault-meme-sub">${meme.subreddit} · ${formatScore(meme.score)}</div>
        </div>
      `;
      el.addEventListener("click", () => {
        swipeIndex = idx;
        swipeMemes = currentDropMemes;
        swipeModeTitle.textContent = currentDropTitle;
        swipeModeEnd.classList.add("hidden");
        swipeModeScreen.classList.remove("hidden");
        renderSwipeCards();
      });
      vaultGrid.appendChild(el);
    });
  }

  // --- Swipe Mode ---
  const swipeModeScreen = document.getElementById("swipe-mode");
  const swipeModeStack = document.getElementById("swipe-mode-stack");
  const swipeModeCounter = document.getElementById("swipe-mode-counter");
  const swipeModeEnd = document.getElementById("swipe-mode-end");
  const swipeModeTitle = document.getElementById("swipe-mode-title");
  const swipeModeBtn = document.getElementById("swipe-mode-btn");
  const swipeModeBack = document.getElementById("swipe-mode-back");
  const swipeModeDone = document.getElementById("swipe-mode-done");

  let swipeMemes = [];
  let swipeIndex = 0;
  let swipeKeyHandler = null;

  function openSwipeMode(dropMemes, title) {
    swipeMemes = dropMemes;
    swipeIndex = 0;
    swipeModeTitle.textContent = title || "swipe mode";
    swipeModeEnd.classList.add("hidden");
    swipeModeScreen.classList.remove("hidden");
    renderSwipeCards();

    // Keyboard nav for swipe mode
    if (swipeKeyHandler) document.removeEventListener("keydown", swipeKeyHandler);
    swipeKeyHandler = (e) => {
      if (swipeModeScreen.classList.contains("hidden")) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (swipeIndex >= swipeMemes.length) return;
        const topCard = swipeModeStack.querySelector('.meme-card[data-index="0"]');
        if (!topCard) return;
        const dir = e.key === "ArrowRight" ? 1 : -1;
        topCard.classList.add("fly-out");
        topCard.style.transform = `translateX(${dir * window.innerWidth * 1.5}px) rotate(${dir * 20}deg)`;
        topCard.style.opacity = "0";
        setTimeout(() => {
          swipeIndex++;
          renderSwipeCards();
        }, 350);
      }
    };
    document.addEventListener("keydown", swipeKeyHandler);
  }

  function renderSwipeCards() {
    swipeModeStack.innerHTML = "";

    if (swipeIndex >= swipeMemes.length) {
      swipeModeCounter.textContent = "";
      swipeModeEnd.classList.remove("hidden");
      return;
    }

    swipeModeCounter.textContent = `${swipeIndex + 1} / ${swipeMemes.length}`;

    const visible = swipeMemes.slice(swipeIndex, swipeIndex + 3);
    visible.forEach((meme, i) => {
      const card = document.createElement("div");
      card.className = "meme-card";
      card.dataset.index = i;
      card.innerHTML = `
        <div class="card-image-wrap">
          <img src="${meme.url}" alt="" loading="${i === 0 ? "eager" : "lazy"}" draggable="false" />
        </div>
        <div class="card-info">
          <div class="card-title">${escapeHtml(meme.title)}</div>
          <div class="card-meta">
            <span>${meme.subreddit}</span>
            <span class="score">${formatScore(meme.score)}</span>
          </div>
        </div>
      `;
      swipeModeStack.appendChild(card);

      if (i === 0) setupSwipeMode(card);
    });
  }

  function setupSwipeMode(card) {
    let startX = 0;
    let cX = 0;
    let dragging = false;

    function onStart(e) {
      dragging = true;
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      card.classList.add("swiping");
    }

    function onMove(e) {
      if (!dragging) return;
      cX = (e.touches ? e.touches[0].clientX : e.clientX) - startX;
      const rotation = cX * 0.04;
      const opacity = 1 - Math.min(Math.abs(cX) / 400, 0.3);
      card.style.transform = `translateX(${cX}px) rotate(${rotation}deg)`;
      card.style.opacity = opacity;
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      card.classList.remove("swiping");

      const threshold = window.innerWidth * 0.2;

      if (Math.abs(cX) > threshold) {
        const direction = cX > 0 ? 1 : -1;
        card.classList.add("fly-out");
        card.style.transform = `translateX(${direction * window.innerWidth * 1.5}px) rotate(${direction * 20}deg)`;
        card.style.opacity = "0";
        setTimeout(() => {
          swipeIndex++;
          renderSwipeCards();
        }, 350);
      } else {
        card.style.transform = "";
        card.style.opacity = "";
      }
      cX = 0;
    }

    card.addEventListener("touchstart", onStart, { passive: true });
    card.addEventListener("touchmove", onMove, { passive: true });
    card.addEventListener("touchend", onEnd);
    card.addEventListener("mousedown", onStart);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
  }

  function closeSwipeMode() {
    swipeModeScreen.classList.add("hidden");
    swipeModeStack.innerHTML = "";
    swipeModeCounter.textContent = "";
    if (swipeKeyHandler) {
      document.removeEventListener("keydown", swipeKeyHandler);
      swipeKeyHandler = null;
    }
  }

  let currentDropMemes = null;
  let currentDropTitle = null;

  swipeModeBtn.addEventListener("click", () => {
    if (currentDropMemes && currentDropMemes.length > 0) {
      openSwipeMode(currentDropMemes, currentDropTitle);
    }
  });

  swipeModeBack.addEventListener("click", closeSwipeMode);
  swipeModeDone.addEventListener("click", closeSwipeMode);

  vaultBtn.addEventListener("click", openVault);
  document.getElementById("end-vault-btn").addEventListener("click", openVault);
  vaultBack.addEventListener("click", () => vaultScreen.classList.add("hidden"));
  vaultDetailBack.addEventListener("click", () => {
    vaultDetail.classList.add("hidden");
    openVault();
  });

  // Vote buttons
  voteUpBtn.addEventListener("click", () => {
    const meme = memes[currentIndex];
    if (meme) castVote(meme.id, "up");
  });
  voteDownBtn.addEventListener("click", () => {
    const meme = memes[currentIndex];
    if (meme) castVote(meme.id, "down");
  });

  // Stats screen
  async function openStats() {
    statsScreen.classList.remove("hidden");
    statsBody.innerHTML = '<div class="vault-empty"><div class="spinner"></div><p>loading...</p></div>';
    try {
      const res = await fetch("/api/stats?t=" + Date.now());
      const data = await res.json();
      if (data.totalVotes === 0) {
        statsBody.innerHTML = '<div class="stats-empty"><p>no votes yet</p><p class="stats-empty-hint">tap thumbs up or down on memes to start training the algorithm</p></div>';
        return;
      }
      const upPct = data.totalVotes > 0 ? Math.round((data.totalUp / data.totalVotes) * 100) : 0;
      let html = `
        <div class="stats-summary">
          <div class="stats-stat"><div class="stats-num">${data.totalUp}</div><div class="stats-label">liked</div></div>
          <div class="stats-stat stats-stat-mid"><div class="stats-num">${upPct}%</div><div class="stats-label">like rate</div></div>
          <div class="stats-stat"><div class="stats-num">${data.totalDown}</div><div class="stats-label">passed</div></div>
        </div>
        <div class="stats-section-title">by subreddit</div>
        <div class="stats-list">
      `;
      data.subreddits.forEach((s) => {
        const pct = Math.round(s.ratio * 100);
        html += `
          <div class="stats-row">
            <div class="stats-row-top">
              <div class="stats-sub">${s.subreddit}</div>
              <div class="stats-pct">${pct}%</div>
            </div>
            <div class="stats-bar"><div class="stats-bar-fill" style="width:${pct}%"></div></div>
            <div class="stats-counts">${s.up} liked · ${s.down} passed</div>
          </div>
        `;
      });
      html += "</div>";
      statsBody.innerHTML = html;
    } catch (e) {
      statsBody.innerHTML = '<div class="vault-empty"><p>failed to load stats</p></div>';
    }
  }
  statsBtn.addEventListener("click", openStats);
  statsBack.addEventListener("click", () => statsScreen.classList.add("hidden"));

  async function fetchVotes() {
    try {
      const res = await fetch("/api/votes?t=" + Date.now());
      const data = await res.json();
      voteState = {};
      for (const [id, v] of Object.entries(data)) {
        voteState[id] = v.vote;
      }
    } catch (e) {
      console.error("fetch votes failed", e);
    }
  }

  // Init
  async function init() {
    const [drop] = await Promise.all([fetchDrop(), fetchVotes()]);
    loader.classList.add("hidden");

    nextDropTime = drop.nextDrop;
    memes = drop.memes || [];
    currentDropId = drop.dropId || null;

    if (memes.length === 0) {
      showWaitingScreen();
      return;
    }

    dropBadge.textContent = `${memes.length} memes`;

    // Check localStorage for viewed state (use droppedAt to detect regenerated drops)
    const viewedKey = `viewed-${drop.dropId}-${drop.droppedAt}`;
    const savedIndex = localStorage.getItem(viewedKey);
    if (savedIndex !== null) {
      currentIndex = parseInt(savedIndex, 10);
    }

    // Save progress on each swipe
    const originalRender = renderCards;
    renderCards = function () {
      localStorage.setItem(viewedKey, currentIndex);
      originalRender();
    };

    renderCards();
  }

  init();
})();
