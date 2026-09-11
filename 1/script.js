(() => {
  'use strict';

  const root = document.documentElement;
  const frontGearPack = document.querySelector('.page--first .gear-pack');
  const reverseGearPack = document.querySelector('.page--second .gear-pack');
  const gearPacks = [frontGearPack, reverseGearPack].filter(Boolean);
  const bounceClasses = [
    'is-opening',
    'is-scroll-bouncing-up',
    'is-scroll-bouncing-down'
  ];
  const lastPage = 2;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const transitionMs = reduceMotion
    ? 180
    : 720;

  let page = 0;
  let locked = false;
  let unlockTimer = 0;
  let touchStartY = null;

  // scroll-lock page indicator (index-only): the active page's dot grows. Pure presentation.
  const pageDots = Array.from(document.querySelectorAll('.page-dot'));
  function updateDots() {
    for (let i = 0; i < pageDots.length; i++) {
      pageDots[i].classList.toggle('is-active', i === page);
    }
  }
  updateDots(); // initial sync (page 0)

  function clearBounce(gearPack) {
    gearPack?.classList.remove(...bounceClasses);
  }

  function playOpeningBounce() {
    if (reduceMotion || !frontGearPack) {
      return;
    }

    window.requestAnimationFrame(() => {
      frontGearPack.classList.add('is-opening');
    });
  }

  function moveTo(nextPage) {
    const boundedPage = Math.max(0, Math.min(lastPage, nextPage));

    if (locked || boundedPage === page) {
      return;
    }

    const previousPage = page;
    page = boundedPage;
    locked = true;
    root.style.setProperty('--page-offset', `${page * -33.333333}%`);
    updateDots();

    gearPacks.forEach(clearBounce);

    let arrivingGearPack = null;

    if (page === 0) {
      arrivingGearPack = frontGearPack;
    } else if (page === 1) {
      arrivingGearPack = reverseGearPack;
    }

    if (!reduceMotion && arrivingGearPack) {
      // The blister TRAILS the page: when the track slides up (scrolling down to
      // the next page) the arriving blister lags downward, then settles up; and
      // vice-versa. So scroll-down → bounce-down, scroll-up → bounce-up.
      const directionClass = page > previousPage
        ? 'is-scroll-bouncing-down'
        : 'is-scroll-bouncing-up';

      arrivingGearPack.classList.add(directionClass);
    }

    window.clearTimeout(unlockTimer);
    unlockTimer = window.setTimeout(() => {
      locked = false;
    }, transitionMs + 80);
  }

  function onWheel(event) {
    event.preventDefault();

    if (locked || Math.abs(event.deltaY) < 8) {
      return;
    }

    moveTo(page + Math.sign(event.deltaY));
  }

  function onTouchStart(event) {
    touchStartY = event.changedTouches[0].clientY;
  }

  function onTouchEnd(event) {
    if (touchStartY === null || locked) {
      touchStartY = null;
      return;
    }

    const delta = touchStartY - event.changedTouches[0].clientY;
    touchStartY = null;

    if (Math.abs(delta) >= 36) {
      moveTo(page + Math.sign(delta));
    }
  }

  function onKeyDown(event) {
    const nextKeys = ['ArrowDown', 'PageDown', ' ', 'End'];
    const previousKeys = ['ArrowUp', 'PageUp', 'Home'];

    if (nextKeys.includes(event.key)) {
      event.preventDefault();
      moveTo(event.key === 'End' ? lastPage : page + 1);
    } else if (previousKeys.includes(event.key)) {
      event.preventDefault();
      moveTo(event.key === 'Home' ? 0 : page - 1);
    }
  }

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  gearPacks.forEach((gearPack) => {
    gearPack.addEventListener('animationend', () => {
      clearBounce(gearPack);
    });
  });

  const bulletin = document.querySelector('.app-bulletin');
  if (bulletin) {
    bulletin.addEventListener('click', () => {
      const target = Number(bulletin.dataset.goto);
      if (Number.isFinite(target)) {
        moveTo(target);
      }
    });
  }

  // Wallet + navigation: OWNED BY tyb-session.js (loaded on all 6 pages) — it injects the app-bar,
  // drives REAL connect/disconnect, and routes every data-action (inventory/gacha/claim/refund; gtd/mint
  // parked for the mint modal). script.js is index-only presentation (snap-scroll / bounce / sparkles) and
  // must NOT also handle data-action or it would double-fire. Only the page-scroll bulletin (data-goto) is here.

  if (document.readyState === 'complete') {
    playOpeningBounce();
  } else {
    window.addEventListener('load', playOpeningBounce, { once: true });
  }

  // --- decorative yellow sparkles: ring the blister (pages 1–2), the GTD card (page 2) + the refund card (page 3) ---
  if (!reduceMotion) {
    const sparkleLayers = [
      document.querySelector('.page--first .sparkles'),
      document.querySelector('.page--second .sparkles'),
      document.querySelector('.page--third .sparkles')
    ];
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const SPARKLE_PATH =
      'M12 0C13.2 8.2 15.8 10.8 24 12 15.8 13.2 13.2 15.8 12 24 10.8 15.8 8.2 13.2 0 12 8.2 10.8 10.8 8.2 12 0Z';
    const SPARKLE_COLORS = ['#ffe14d', '#ffd21f', '#ffe97a'];
    const MAX_PER_LAYER = 20;

    function clampPct(value) {
      return Math.max(3, Math.min(97, value));
    }

    // build + place one star at (leftPct, topPct) of the layer, with the shared size/drift/fade look
    function placeSpark(layer, leftPct, topPct) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'spk');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', SPARKLE_PATH);
      svg.appendChild(path);

      // Size + drift scale with the frame width so sparkles look identical on mobile and desktop.
      const fw = layer.clientWidth || 400;
      const size = fw * (0.033 + Math.random() * 0.043); // ~3.3–7.6% of frame width
      const duration = 1 + Math.random() * 2; // 1–3s life
      const driftX = (Math.random() * 2 - 1) * fw * 0.053; // ±5.3% of frame width
      const driftY = -fw * (0.058 + Math.random() * 0.106); // float up ~5.8–16.4%
      const rot0 = Math.random() * 40 - 20;
      const rot1 = rot0 + (Math.random() * 50 - 25);

      const style = svg.style;
      style.left = clampPct(leftPct).toFixed(2) + '%';
      style.top = clampPct(topPct).toFixed(2) + '%';
      style.setProperty('--sz', size.toFixed(1) + 'px');
      style.setProperty('--dur', duration.toFixed(2) + 's');
      style.setProperty('--dx', driftX.toFixed(1) + 'px');
      style.setProperty('--dy', driftY.toFixed(1) + 'px');
      style.setProperty('--r0', rot0.toFixed(1) + 'deg');
      style.setProperty('--r1', rot1.toFixed(1) + 'deg');
      style.setProperty('--col', SPARKLE_COLORS[(Math.random() * SPARKLE_COLORS.length) | 0]);

      svg.addEventListener('animationend', () => svg.remove());
      layer.appendChild(svg);

      while (layer.childElementCount > MAX_PER_LAYER) {
        layer.firstElementChild.remove();
      }
    }

    // ring the blister (it sits centered in the page → ring the layer's center) — original look
    function spawnBlister(layer) {
      if (!layer) { return; }
      const angle = Math.random() * Math.PI * 2;
      const radiusFactor = 0.6 + Math.random() * 0.42;
      placeSpark(layer, 50 + Math.cos(angle) * 46 * radiusFactor, 50 + Math.sin(angle) * 40 * radiusFactor);
    }

    // ring around a specific element (GTD card, refund card): measure its box within the layer at spawn time
    function spawnAround(layer, el) {
      if (!layer || !el) { return; }
      const lr = layer.getBoundingClientRect();
      const t = el.getBoundingClientRect();
      if (!lr.width || !lr.height || !t.width || !t.height) { return; }
      const cx = ((t.left + t.width / 2) - lr.left) / lr.width * 100;
      const cy = ((t.top + t.height / 2) - lr.top) / lr.height * 100;
      const rx = (t.width / 2) / lr.width * 100;
      const ry = (t.height / 2) / lr.height * 100;
      const angle = Math.random() * Math.PI * 2;
      const radiusFactor = 0.92 + Math.random() * 0.3; // land just around the perimeter
      placeSpark(layer, cx + Math.cos(angle) * rx * radiusFactor, cy + Math.sin(angle) * ry * radiusFactor);
    }

    let sparkleTimer = 0;

    function sparkleLoop() {
      window.clearTimeout(sparkleTimer);
      try {
        if (page === 0) {
          spawnBlister(sparkleLayers[0]);
        } else if (page === 1) {
          spawnBlister(sparkleLayers[1]); // the reverse pack
          spawnAround(sparkleLayers[1], document.querySelector('.reverse-buttons .rev-btn[data-action="gtd"]')); // the GTD card, same intensity
        } else if (page === 2) {
          spawnAround(sparkleLayers[2], document.querySelector('.page--third .refund-card'));
        }
      } catch (err) {
        // never let one bad spawn kill the loop permanently
      }
      sparkleTimer = window.setTimeout(sparkleLoop, 240 + Math.random() * 320); // 240–560ms
    }

    // Browsers pause CSS animations and throttle/park timers while a tab is hidden; re-kick on re-show.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        sparkleLoop();
      }
    });

    sparkleLoop();
  }
})();
