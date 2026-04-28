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

  let memes = [];
  let currentIndex = 0;
  let nextDropTime = null;
  let countdownInterval = null;
  let hintDismissed = false;

  async function fetchDrop() {
    try {
      const res = await fetch("/api/drop");
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
        // Auto-refresh when drop time hits
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
    endScreen.classList.remove("hidden");
    startCountdown();
  }

  function showWaitingScreen() {
    stack.innerHTML = "";
    counter.textContent = "";
    hint.classList.add("hidden");
    waitingScreen.classList.remove("hidden");
    startCountdown();
  }

  function renderCards() {
    stack.innerHTML = "";

    if (currentIndex >= memes.length) {
      showEndScreen();
      return;
    }

    updateCounter();

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
        const direction = currentX > 0 ? 1 : -1;
        card.classList.add("fly-out");
        card.style.transform = `translateX(${direction * window.innerWidth * 1.5}px) rotate(${direction * 20}deg)`;
        card.style.opacity = "0";
        setTimeout(() => {
          currentIndex++;
          renderCards();
        }, 350);
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

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (currentIndex >= memes.length) return;
      const topCard = stack.querySelector('.meme-card[data-index="0"]');
      if (!topCard) return;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      topCard.classList.add("fly-out");
      topCard.style.transform = `translateX(${dir * window.innerWidth * 1.5}px) rotate(${dir * 20}deg)`;
      topCard.style.opacity = "0";
      setTimeout(() => {
        currentIndex++;
        renderCards();
      }, 350);
    }
  });

  // Init
  async function init() {
    const drop = await fetchDrop();
    loader.classList.add("hidden");

    nextDropTime = drop.nextDrop;
    memes = drop.memes || [];

    if (memes.length === 0) {
      showWaitingScreen();
      return;
    }

    dropBadge.textContent = `${memes.length} memes`;

    // Check localStorage for viewed state
    const viewedKey = `viewed-${drop.dropId}`;
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
