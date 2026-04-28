(() => {
  const stack = document.getElementById("card-stack");
  const loader = document.getElementById("loader");
  const hint = document.getElementById("swipe-hint");

  let memes = [];
  let currentIndex = 0;
  let page = 0;
  let loading = false;
  let hintDismissed = false;

  async function fetchMemes() {
    if (loading) return;
    loading = true;
    try {
      const res = await fetch(`/api/memes?page=${page}`);
      const data = await res.json();
      if (data.memes && data.memes.length) {
        memes.push(...data.memes);
        page++;
      }
    } catch (e) {
      console.error("fetch failed", e);
    }
    loading = false;
  }

  function preloadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  function renderCards() {
    stack.innerHTML = "";
    const visible = memes.slice(currentIndex, currentIndex + 3);
    visible.forEach((meme, i) => {
      const card = document.createElement("div");
      card.className = "meme-card";
      card.dataset.index = i;
      card.innerHTML = `
        <div class="card-image-wrap">
          <img src="${meme.url}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}" />
        </div>
        <div class="card-info">
          <div class="card-title">${escapeHtml(meme.title)}</div>
          <div class="card-meta">
            <span>${meme.subreddit}</span>
            <span>${formatScore(meme.score)}</span>
          </div>
        </div>
      `;
      stack.appendChild(card);

      if (i === 0) {
        setupSwipe(card);
      }
    });

    // Prefetch more when running low
    if (currentIndex >= memes.length - 5) {
      fetchMemes();
    }
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
      const rotation = currentX * 0.05;
      card.style.transform = `translateX(${currentX}px) rotate(${rotation}deg)`;
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;
      card.classList.remove("swiping");

      const threshold = window.innerWidth * 0.25;

      if (Math.abs(currentX) > threshold) {
        // Fly out
        const direction = currentX > 0 ? 1 : -1;
        card.classList.add("fly-out");
        card.style.transform = `translateX(${direction * window.innerWidth * 1.5}px) rotate(${direction * 30}deg)`;
        setTimeout(() => {
          currentIndex++;
          renderCards();
        }, 300);
      } else {
        // Snap back
        card.style.transform = "";
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

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatScore(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const topCard = stack.querySelector('.meme-card[data-index="0"]');
      if (!topCard) return;
      const dir = e.key === "ArrowRight" ? -1 : -1;
      topCard.classList.add("fly-out");
      topCard.style.transform = `translateX(${dir * window.innerWidth * 1.5}px) rotate(${dir * 30}deg)`;
      setTimeout(() => {
        currentIndex++;
        renderCards();
      }, 300);
    }
  });

  // Init
  async function init() {
    await fetchMemes();
    loader.classList.add("hidden");
    renderCards();
  }

  init();
})();
