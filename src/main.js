(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / Math.max(1e-6, b - a));
    return t * t * (3 - 2 * t);
  };
  const fadeWindow = (p, start, end, feather = 0.07) => {
    const f = Math.min(feather, Math.max(0.02, (end - start) * 0.34));
    return smoothstep(start, start + f, p) * (1 - smoothstep(end - f, end, p));
  };

  const body = document.body;
  const loader = $('#loader');
  const loaderTrack = $('#loaderTrack');
  const loaderStatus = $('#loaderStatus');
  const loaderPercent = $('#loaderPercent');
  const mediaGuard = $('#mediaGuard');
  const topbar = $('#topbar');
  const heroSection = $('#cinematic');
  const heroVideo = $('#heroVideo');
  const filmCard = $('#filmCard');
  const frameReadout = $('#frameReadout');
  const heroTimecode = $('#heroTimecode');
  const heroProgressEl = $('#heroProgress');
  const railFill = $('#railFill');
  const railIndex = $('#railIndex');
  const heroScenes = $$('.hero-scene');
  const sections = $$('[data-chapter]');
  const soundButton = $('#soundButton');
  const backgroundMusic = $('#backgroundMusic');
  const heartbeatAudio = $('#heartbeatAudio');
  const cursor = $('#cursor');
  const depthCanvas = $('#depthCanvas');
  const confettiCanvas = $('#confettiCanvas');
  const helixCanvas = $('#helixCanvas');
  const inviteStage = $('#inviteStage');
  const inviteCard = $('#inviteCard');
  const mailIntro = $('#mailIntro');
  const mailStage = $('#mailStage');
  const mailEnvelope = $('#mailEnvelope');
  const mailCard = $('#mailCard');
  const mailSeal = $('#mailSeal');
  const finaleSection = $('#finale');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mobile = matchMedia('(max-width: 820px)').matches || coarse;
  const saveData = !!navigator.connection?.saveData;
  const deviceMemory = navigator.deviceMemory || 8;
  const lowPower = reduceMotion || saveData || deviceMemory <= 4 || (navigator.hardwareConcurrency || 8) <= 4;

  const FPS = 15;
  const TOTAL_FRAMES = 231;

  let viewportH = innerHeight;
  let viewportW = innerWidth;
  let scrollY = window.scrollY;
  let targetHeroP = 0;
  let smoothHeroP = 0;
  let targetFrame = 0;
  let displayedFrame = 0;
  let lastAppliedFrame = -1;
  let heroReady = false;
  let heroVideoFailed = false;
  let heroVideoLoadPromise = null;
  let heroStoryGateUntil = 0;
  let loaderClosed = false;
  let raf = 0;
  let lastScrollY = scrollY;
  let scrollVelocity = 0;
  let pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let chapterMetrics = [];
  let activeChapter = 0;
  const AUTO_SCROLL_CONFIG = {
    rates: [1, 1.5, 2, 2.5, 3],
    defaultRateIndex: 0,
    wordsPerMinute: 220,
    initialDelayMs: 1100,
    minSeconds: { hero: 28, chapter: 12, finale: 21 },
    maxSeconds: { hero: 36, chapter: 17, finale: 30 },
    readingPaddingSeconds: { hero: 4, chapter: 3.5, finale: 5.5 },
    pixelsPerSecond: { hero: 145, chapter: 125, finale: 105 }
  };

  const autoScroll = {
    segments: [],
    segmentIndex: 0,
    segmentProgress: 0,
    rateIndex: AUTO_SCROLL_CONFIG.defaultRateIndex,
    active: false,
    paused: false,
    ended: false,
    manualOverride: false,
    resumeAt: 0,
    lastTime: performance.now()
  };

  const autoScrollControl = $('#autoScrollControl');
  const autoScrollToggle = $('#autoScrollToggle');
  const autoScrollSpeed = $('#autoScrollSpeed');

  function maxScrollY() {
    return Math.max(0, document.documentElement.scrollHeight - innerHeight);
  }

  function manualScrollStartY() {
    if (!finaleSection) return Infinity;
    return clamp(finaleSection.offsetTop, 0, maxScrollY());
  }

  function isInvitationManualZone(y = window.scrollY) {
    return y >= manualScrollStartY() - 2;
  }

  function updateInvitationManualReadiness(y = window.scrollY) {
    body.classList.toggle(
      'invitation-manual-ready',
      body.classList.contains('invitation-entered') && isInvitationManualZone(y)
    );
  }

  function setManualScrollPhase(active) {
    const enabled = !!active;
    autoScroll.manualOverride = enabled;
    body.classList.toggle('manual-scroll-active', enabled);
    if (enabled) {
      autoScroll.active = false;
      autoScroll.paused = false;
      autoScroll.lastTime = performance.now();
    }
    updateInvitationManualReadiness();
    updateAutoScrollControls();
  }

  function countReadableWords(el) {
    if (!el) return 0;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script,style,svg,canvas,video,audio,.chapter__number,.hero-chrome,.rail,.finale__footer').forEach((node) => node.remove());
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    return text ? text.split(' ').filter(Boolean).length : 0;
  }

  function durationForSection(el, startY, endY, kind) {
    const words = countReadableWords(el);
    const readingSeconds = (words / AUTO_SCROLL_CONFIG.wordsPerMinute) * 60 + AUTO_SCROLL_CONFIG.readingPaddingSeconds[kind];
    const distanceSeconds = Math.max(0, endY - startY) / AUTO_SCROLL_CONFIG.pixelsPerSecond[kind];
    const wanted = Math.max(readingSeconds, distanceSeconds);
    return clamp(wanted, AUTO_SCROLL_CONFIG.minSeconds[kind], AUTO_SCROLL_CONFIG.maxSeconds[kind]);
  }

  function buildAutoScrollTimeline() {
    const maxY = maxScrollY();
    const raw = [];
    if (heroSection) raw.push({ el: heroSection, kind: 'hero' });
    sections.forEach((el) => raw.push({ el, kind: el.classList.contains('finale') ? 'finale' : 'chapter' }));

    autoScroll.segments = raw.map((item, index) => {
      const startY = clamp(item.el.offsetTop, 0, maxY);
      const nextTop = raw[index + 1]?.el?.offsetTop;
      const endY = clamp(index === raw.length - 1 ? maxY : (nextTop ?? maxY), startY, maxY);
      return {
        ...item,
        startY,
        endY,
        duration: durationForSection(item.el, startY, endY, item.kind)
      };
    }).filter((segment, index, arr) => segment.endY > segment.startY || index === arr.length - 1);
  }

  function currentAutoRate() {
    return AUTO_SCROLL_CONFIG.rates[autoScroll.rateIndex] || 1;
  }

  function updateAutoScrollControls() {
    const faRates = ['۱×', '۱٫۵×', '۲×', '۲٫۵×', '۳×'];
    if (autoScrollSpeed) {
      autoScrollSpeed.textContent = faRates[autoScroll.rateIndex] || `${currentAutoRate()}×`;
      autoScrollSpeed.setAttribute('aria-label', `تغییر سرعت پخش خودکار؛ سرعت فعلی ${currentAutoRate()} برابر`);
    }
    if (autoScrollToggle) {
      const replay = autoScroll.ended;
      autoScrollToggle.dataset.state = replay ? 'replay' : (autoScroll.paused ? 'play' : 'pause');
      autoScrollToggle.setAttribute('aria-label', replay ? 'پخش دوباره روایت از ابتدا' : (autoScroll.paused ? 'ادامه پخش خودکار' : 'توقف موقت پخش خودکار'));
      const icon = $('.auto-scroll-control__icon', autoScrollToggle);
      if (icon) icon.textContent = replay ? '↻' : (autoScroll.paused ? '▶' : 'Ⅱ');
    }
    autoScrollControl?.classList.toggle('is-paused', autoScroll.paused);
    autoScrollControl?.classList.toggle('is-ended', autoScroll.ended);
    const ownsScroll = autoScroll.active && !autoScroll.paused && !autoScroll.ended && !autoScroll.manualOverride;
    body.classList.toggle('auto-scroll-running', ownsScroll);
  }

  function syncAutoScrollTo(y, now = performance.now()) {
    if (!autoScroll.segments.length) buildAutoScrollTimeline();
    const clampedY = clamp(y, 0, maxScrollY());
    let index = autoScroll.segments.findIndex((segment) => clampedY >= segment.startY && clampedY < segment.endY);
    if (index < 0) index = Math.max(0, autoScroll.segments.length - 1);
    const segment = autoScroll.segments[index];
    autoScroll.segmentIndex = index;
    autoScroll.segmentProgress = segment && segment.endY > segment.startY ? clamp((clampedY - segment.startY) / (segment.endY - segment.startY)) : 0;
    autoScroll.lastTime = now;
    window.scrollTo(0, clampedY);
    updateInvitationManualReadiness(clampedY);
  }

  function startAutoScroll({ reset = false, delay = AUTO_SCROLL_CONFIG.initialDelayMs, force = false } = {}) {
    if (autoScroll.manualOverride && !force) return;
    if (force) setManualScrollPhase(false);
    buildAutoScrollTimeline();
    if (!autoScroll.segments.length) return;
    if (reset || autoScroll.ended) syncAutoScrollTo(0);
    else syncAutoScrollTo(window.scrollY);
    autoScroll.active = true;
    autoScroll.paused = false;
    autoScroll.ended = false;
    autoScroll.resumeAt = performance.now() + Math.max(0, delay);
    autoScroll.lastTime = performance.now();
    body.classList.add('auto-scroll-mode');
    updateAutoScrollControls();
  }

  function pauseAutoScroll() {
    if (!autoScroll.active || autoScroll.ended) return;
    autoScroll.paused = true;
    updateAutoScrollControls();
  }

  function resumeAutoScroll() {
    if (autoScroll.ended) {
      startAutoScroll({ reset: true, delay: 700, force: true });
      return;
    }
    autoScroll.active = true;
    autoScroll.paused = false;
    autoScroll.lastTime = performance.now();
    autoScroll.resumeAt = performance.now() + 250;
    updateAutoScrollControls();
  }

  async function seekAutoScroll(y) {
    const targetY = clamp(y, 0, maxScrollY());
    if (!autoScroll.segments.length) buildAutoScrollTimeline();
    let targetIndex = autoScroll.segments.findIndex((segment) => targetY >= segment.startY && targetY < segment.endY);
    if (targetIndex < 0) targetIndex = Math.max(0, autoScroll.segments.length - 1);
    if (!sectionMediaReady.has(targetIndex)) {
      showMediaGuard(true);
      try { await warmSectionMedia(targetIndex); } finally { showMediaGuard(false); }
    }
    if (autoScroll.manualOverride) {
      window.scrollTo({ top: targetY, behavior: reduceMotion ? 'auto' : 'smooth' });
      updateInvitationManualReadiness(targetY);
      return;
    }
    syncAutoScrollTo(targetY);
    autoScroll.ended = false;
    autoScroll.active = true;
    autoScroll.paused = false;
    autoScroll.resumeAt = performance.now() + 450;
    updateAutoScrollControls();
  }

  function stepAutoScroll(now = performance.now()) {
    if (!autoScroll.active || autoScroll.paused || autoScroll.ended) {
      autoScroll.lastTime = now;
      return;
    }
    if (!body.classList.contains('invitation-entered') || body.classList.contains('invitation-opening') || now < autoScroll.resumeAt) {
      autoScroll.lastTime = now;
      return;
    }
    if (!autoScroll.segments.length) buildAutoScrollTimeline();
    const segment = autoScroll.segments[autoScroll.segmentIndex];
    if (!segment) return;
    if (segment.kind === 'hero' && !heroReady && now < heroStoryGateUntil) {
      autoScroll.lastTime = now;
      return;
    }

    // Stay comfortably ahead of the viewer. The next section is decoded early,
    // and the section after that starts warming as the current scene progresses.
    if (autoScroll.segmentProgress > .42) void warmSectionMedia(autoScroll.segmentIndex + 1);
    if (autoScroll.segmentProgress > .78) void warmSectionMedia(autoScroll.segmentIndex + 2);

    const dt = Math.min(0.08, Math.max(0, (now - autoScroll.lastTime) / 1000));
    autoScroll.lastTime = now;
    autoScroll.segmentProgress += (dt * currentAutoRate()) / Math.max(0.1, segment.duration);

    while (autoScroll.segmentProgress >= 1) {
      const overflow = autoScroll.segmentProgress - 1;
      if (autoScroll.segmentIndex >= autoScroll.segments.length - 1) {
        window.scrollTo(0, segment.endY);
        autoScroll.segmentProgress = 1;
        autoScroll.active = false;
        autoScroll.ended = true;
        updateAutoScrollControls();
        return;
      }

      const nextIndex = autoScroll.segmentIndex + 1;
      if (!sectionMediaReady.has(nextIndex)) {
        // Hold the camera one pixel before the next scene until its background
        // and foreground images are decoded. This prevents blank/late media.
        autoScroll.segmentProgress = .999;
        window.scrollTo(0, Math.max(segment.startY, segment.endY - 1));
        if (mediaBoundaryIndex !== nextIndex) {
          mediaBoundaryIndex = nextIndex;
          showMediaGuard(true);
          void warmSectionMedia(nextIndex).finally(() => {
            if (mediaBoundaryIndex === nextIndex) {
              mediaBoundaryIndex = -1;
              showMediaGuard(false);
            }
          });
        }
        return;
      }

      window.scrollTo(0, segment.endY);
      autoScroll.segmentIndex = nextIndex;
      const next = autoScroll.segments[autoScroll.segmentIndex];
      autoScroll.segmentProgress = overflow * (segment.duration / Math.max(0.1, next.duration));
    }

    const live = autoScroll.segments[autoScroll.segmentIndex];
    const y = lerp(live.startY, live.endY, clamp(autoScroll.segmentProgress));
    window.scrollTo(0, y);
    updateInvitationManualReadiness(y);
  }

  function blockManualVerticalScroll() {
    const isEditableTarget = () => {
      const tag = document.activeElement?.tagName;
      return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag) || document.activeElement?.isContentEditable;
    };
    const isScrollKey = (key) => ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(key);
    const manualAllowedHere = () => body.classList.contains('invitation-entered') && !body.classList.contains('manual-scroll-accessibility') && isInvitationManualZone();
    const autoOwnsScroll = () => autoScroll.active && !autoScroll.paused && !autoScroll.ended && !autoScroll.manualOverride;
    const shouldBlock = () => body.classList.contains('invitation-entered') && !body.classList.contains('manual-scroll-accessibility') && autoOwnsScroll() && !manualAllowedHere();

    const handOffToManual = () => {
      if (autoScroll.manualOverride || !manualAllowedHere()) return false;
      setManualScrollPhase(true);
      return true;
    };

    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (handOffToManual()) return;
      if (shouldBlock() && e.cancelable) e.preventDefault();
    }, { passive: false, capture: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      if (handOffToManual()) return;
      if (shouldBlock() && e.cancelable) e.preventDefault();
    }, { passive: false, capture: true });

    window.addEventListener('keydown', (e) => {
      if (!isScrollKey(e.key) || isEditableTarget()) return;
      if (handOffToManual()) return;
      if (shouldBlock()) e.preventDefault();
    }, { capture: true });

    window.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      if (handOffToManual()) return;
      if (shouldBlock()) e.preventDefault();
    }, { capture: true });
  }

  function initAutoScroll() {
    buildAutoScrollTimeline();
    blockManualVerticalScroll();
    autoScrollToggle?.addEventListener('click', () => {
      if (autoScroll.ended) resumeAutoScroll();
      else if (autoScroll.paused) resumeAutoScroll();
      else pauseAutoScroll();
    });
    autoScrollSpeed?.addEventListener('click', () => {
      autoScroll.rateIndex = (autoScroll.rateIndex + 1) % AUTO_SCROLL_CONFIG.rates.length;
      updateAutoScrollControls();
    });
    updateAutoScrollControls();
  }

  // Only what is visible on the very first screen. Everything else is warmed
  // later by warmSectionMedia()/warmVisualAssets(), after the loader closes.
  const criticalManifest = [
    'assets/mazums-logo-official-gold.svg',
    'assets/mazums-logo-official-ivory.svg',
    heroVideo?.getAttribute('poster') || 'assets/hero-poster-1600.webp'
  ];

  const warmManifest = [
    'assets/learning-1600.webp',
    'assets/clinical-surgery-1600.webp',
    'assets/graduation-group-1600.webp',
    'assets/graduation-portrait-1600.webp',
    'assets/finale-1600.webp'
  ];

  const sectionMediaManifest = [
    ['assets/hero-poster.webp', 'assets/hero-poster-1600.webp'],
    ['assets/campus-aerial-1600.webp', 'assets/campus-drive-1600.webp'],
    ['assets/learning-1600.webp'],
    ['assets/clinical-surgery-1600.webp'],
    ['assets/graduation-group-1600.webp', 'assets/graduation-portrait-1600.webp'],
    ['assets/finale-1600.webp']
  ];

  const mediaJobs = new Map();
  const sectionMediaJobs = new Map();
  const sectionMediaReady = new Set();
  let mediaGuardDepth = 0;
  let mediaBoundaryIndex = -1;

  // Loader updates are batched to at most one DOM write per frame, and only
  // when the visible value actually changes.
  const faNumber = new Intl.NumberFormat('fa-IR');
  let loaderPending = null;
  let loaderShownValue = -1;
  let loaderShownStatus = '';

  function setLoader(p, status = '') {
    const scheduled = !!loaderPending;
    loaderPending = { p, status: status || loaderPending?.status || '' };
    if (scheduled) return;
    requestAnimationFrame(() => {
      const { p: next, status: nextStatus } = loaderPending;
      loaderPending = null;
      const v = Math.round(clamp(next) * 100);
      if (v !== loaderShownValue) {
        loaderShownValue = v;
        if (loaderTrack) loaderTrack.style.width = `${v}%`;
        if (loader) loader.style.setProperty('--loader-p', `${v}%`);
        if (loaderPercent) loaderPercent.textContent = `${faNumber.format(v)}٪`;
      }
      if (loaderStatus && nextStatus && nextStatus !== loaderShownStatus) {
        loaderShownStatus = nextStatus;
        loaderStatus.textContent = nextStatus;
      }
    });
  }

  function closeLoader() {
    if (loaderClosed) return;
    loaderClosed = true;
    body.classList.remove('is-loading');
    body.classList.add('is-ready');
    setLoader(1, 'همه‌چیز برای شروع آماده است');
    loader?.classList.add('is-hidden');
    setTimeout(() => loader?.remove(), 900);
  }

  function showMediaGuard(show) {
    if (!mediaGuard) return;
    if (show) mediaGuardDepth += 1;
    else mediaGuardDepth = Math.max(0, mediaGuardDepth - 1);
    const visible = mediaGuardDepth > 0;
    mediaGuard.classList.toggle('is-visible', visible);
    mediaGuard.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  // decode() on an image that is never inserted into the page is usually wasted
  // work: the browser decodes again when the real <img>/background paints.
  // Only decode when the caller is about to show the image and is blocking on it.
  function preloadImage(url, { priority = 'auto', decode = false } = {}) {
    if (mediaJobs.has(url)) return mediaJobs.get(url);
    const job = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      try { img.fetchPriority = priority; } catch {}
      const finish = async (ok) => {
        if (ok && decode && typeof img.decode === 'function') {
          try { await img.decode(); } catch {}
        }
        resolve(!!ok);
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = url;
      if (img.complete && img.naturalWidth > 0) finish(true);
    }).then((ok) => {
      if (!ok) mediaJobs.delete(url);
      return ok;
    });
    mediaJobs.set(url, job);
    return job;
  }

  function heroVideoSource() {
    return heroVideo?.dataset.src || heroVideo?.getAttribute('src') || 'assets/hero-scrub-mobile.mp4';
  }

  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(false), ms))
  ]);

  async function preloadCriticalAssets(onProgress) {
    let settled = 0;
    const total = Math.max(1, criticalManifest.length);
    const tasks = criticalManifest.map((url) => preloadImage(url, { priority: 'high' }).then((ok) => {
      settled += 1;
      onProgress?.(settled / total);
      return ok;
    }));
    const results = await Promise.all(tasks);
    onProgress?.(1);
    return results.every(Boolean);
  }

  async function waitForFonts(onProgress) {
    if (!document.fonts?.ready) {
      onProgress?.(1);
      return true;
    }
    onProgress?.(.15);
    const ok = await withTimeout(document.fonts.ready.then(() => true).catch(() => false), 8000);
    onProgress?.(1);
    return !!ok;
  }

  function networkConcurrency() {
    if (saveData) return 1;
    const type = navigator.connection?.effectiveType || '';
    if (type.includes('2g')) return 1;
    if (type === '3g') return 2;
    return lowPower ? 2 : 4;
  }

  async function runMediaQueue(urls, concurrency = networkConcurrency()) {
    const queue = [...new Set(urls)];
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, async () => {
      while (cursor < queue.length) {
        const url = queue[cursor++];
        await preloadImage(url, { priority: 'low' }).catch(() => false);
      }
    });
    await Promise.all(workers);
  }

  async function warmSectionMedia(index, { guarded = false } = {}) {
    if (sectionMediaReady.has(index)) return true;
    if (sectionMediaJobs.has(index)) return sectionMediaJobs.get(index);
    const urls = sectionMediaManifest[index] || [];
    if (!urls.length) {
      sectionMediaReady.add(index);
      return true;
    }
    if (guarded) showMediaGuard(true);
    const job = (async () => {
      let results = await Promise.all(urls.map((url) => preloadImage(url, { priority: guarded ? 'high' : 'auto', decode: guarded })));
      if (results.some((ok) => !ok)) {
        await new Promise((resolve) => setTimeout(resolve, 280));
        results = await Promise.all(urls.map((url) => preloadImage(url, { priority: 'high', decode: guarded })));
      }
      // A repeated network/file error must not deadlock the page. Successful files
      // are guaranteed decoded; failed files fall back to the section's background color.
      sectionMediaReady.add(index);
      return results.every(Boolean);
    })().finally(() => {
      if (guarded) showMediaGuard(false);
    });
    sectionMediaJobs.set(index, job);
    return job;
  }

  function initSectionWarmObserver() {
    if (!('IntersectionObserver' in window)) return;
    const targets = [heroSection, ...sections].filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const chapter = entry.target === heroSection ? 0 : Number(entry.target.dataset.chapter || 0);
        void warmSectionMedia(chapter);
        void warmSectionMedia(Math.min(sectionMediaManifest.length - 1, chapter + 1));
      });
    }, { rootMargin: '180% 0px 180% 0px', threshold: 0.01 });
    targets.forEach((el) => observer.observe(el));
  }

  function warmServiceWorkerCache(urls) {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({ type: 'WARM_ASSETS', urls: [...new Set(urls)] });
    }).catch(() => {});
  }

  function warmVisualAssets() {
    const run = async () => {
      // Near-future sections get first claim on bandwidth, then the remainder is
      // downloaded with network-aware concurrency in the background.
      await Promise.allSettled([warmSectionMedia(1), warmSectionMedia(2)]);
      await runMediaQueue(warmManifest, networkConcurrency());
      warmServiceWorkerCache([...criticalManifest, ...warmManifest, heroVideoSource()]);
    };
    if (globalThis.scheduler?.postTask) {
      globalThis.scheduler.postTask(run, { priority: 'background' }).catch(() => run());
    } else if ('requestIdleCallback' in window) {
      requestIdleCallback(() => void run(), { timeout: 900 });
    } else {
      setTimeout(() => void run(), 40);
    }
  }

  // The browser streams the video natively (no Blob copy, no source switching,
  // so it is only ever decoded by one decoder). heroReady flips to true whenever
  // the first frame arrives, even if that happens after a timeout elsewhere.
  function bindVideoSource() {
    if (heroVideoLoadPromise) return heroVideoLoadPromise;

    heroVideoLoadPromise = new Promise((resolve) => {
      let settled = false;
      const settle = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const markReady = () => {
        if (!heroReady) {
          heroReady = true;
          heroVideoFailed = false;
          try { heroVideo.pause(); heroVideo.currentTime = 0; } catch {}
          displayedFrame = 0;
          targetFrame = 0;
          lastAppliedFrame = -1;
          sectionMediaReady.add(0);
          updateAutoScrollControls();
        }
        settle(true);
      };
      const onError = () => {
        heroVideoFailed = true;
        settle(false);
      };

      heroVideo.muted = true;
      heroVideo.playsInline = true;
      heroVideo.setAttribute('playsinline', '');
      heroVideo.setAttribute('webkit-playsinline', '');
      heroVideo.preload = 'auto';

      heroVideo.addEventListener('loadeddata', markReady, { once: true });
      heroVideo.addEventListener('error', onError, { once: true });

      if (!heroVideo.getAttribute('src') && !heroVideo.currentSrc) {
        heroVideo.src = heroVideoSource();
      }
      // Only (re)start loading if the element is not already fetching.
      if (heroVideo.readyState === 0 && heroVideo.networkState !== HTMLMediaElement.NETWORK_LOADING) {
        try { heroVideo.load(); } catch {}
      }
      if (heroVideo.readyState >= 2) markReady();
    });
    return heroVideoLoadPromise;
  }

  async function ensureHeroVideoReadyForStory(maxWaitMs = 5000) {
    if (reduceMotion || heroReady) return true;
    heroStoryGateUntil = performance.now() + Math.max(2500, maxWaitMs + 3500);
    return !!(await withTimeout(bindVideoSource(), maxWaitMs));
  }


  function computeMetrics() {
    viewportH = innerHeight;
    viewportW = innerWidth;
    chapterMetrics = sections.map((section) => {
      const cl = section.classList;
      return {
        el: section,
        top: section.offsetTop,
        height: section.offsetHeight,
        span: Math.max(1, section.offsetHeight - viewportH),
        chapter: Number(section.dataset.chapter || 0),
        isChapter: cl.contains('chapter'),
        isCampus: cl.contains('chapter--campus'),
        isLearning: cl.contains('chapter--learning'),
        isClinical: cl.contains('chapter--clinical'),
        isGraduation: cl.contains('chapter--graduation'),
        isFinale: cl.contains('finale'),
        content: $('.chapter__content', section),
        tilts: $$('[data-tilt]', section),
        wasActive: true // guarantees every chapter is rendered once
      };
    });
    heroTop = heroSection.offsetTop;
    heroHeight = heroSection.offsetHeight;
    docMaxScroll = Math.max(1, document.documentElement.scrollHeight - viewportH);
    lastHeroUIP = -1;
    needsRender = true;
    resizeCanvases();
  }

  let heroTop = 0;
  let heroHeight = 0;
  let docMaxScroll = 1;
  let lastHeroUIP = -1;
  let needsRender = true;
  let lastRenderedScrollY = -1;
  const filmShine = $('.film-card__shine');

  function heroProgressFromScroll(y) {
    const span = Math.max(1, heroSection.offsetHeight - viewportH);
    return clamp((y - heroSection.offsetTop) / span);
  }

  function applyHeroFrame() {
    if (!heroReady || reduceMotion) return;
    targetFrame = Math.round(targetHeroP * (TOTAL_FRAMES - 1));
    const diff = targetFrame - displayedFrame;
    if (Math.abs(diff) >= 0.5) {
      const maxStep = mobile ? 2.3 : 3.8;
      displayedFrame += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    } else {
      displayedFrame = targetFrame;
    }
    const frame = clamp(Math.round(displayedFrame), 0, TOTAL_FRAMES - 1);
    if (frame !== lastAppliedFrame && heroVideo.readyState >= 1) {
      const safeDuration = Math.max((heroVideo.duration || (TOTAL_FRAMES / FPS)) - 0.04, 0);
      const time = Math.min(frame / FPS, safeDuration);
      try {
        heroVideo.pause();
        heroVideo.currentTime = time;
      } catch {}
      lastAppliedFrame = frame;
      if (frameReadout) frameReadout.textContent = `FRAME ${String(frame).padStart(3, '0')} / ${TOTAL_FRAMES - 1}`;
      const seconds = frame / FPS;
      const s = Math.floor(seconds);
      const ff = frame % FPS;
      if (heroTimecode) heroTimecode.textContent = `00:${String(s).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
    }
  }

  function updateHeroUI(p) {
    const heroVisible = scrollY < heroTop + heroHeight;
    if (!heroVisible && Math.abs(p - lastHeroUIP) < 1e-4) return;
    lastHeroUIP = p;
    heroProgressEl.style.width = `${p * 100}%`;
    heroScenes.forEach((scene, i) => {
      const start = Number(scene.dataset.start || 0);
      const end = Number(scene.dataset.end || 1);
      const alpha = reduceMotion ? (i === 0 ? 1 : 0) : fadeWindow(p, start, end, 0.075);
      const local = clamp((p - start) / Math.max(1e-6, end - start));
      const y = (0.5 - local) * (mobile ? 20 : 44);
      const blur = (1 - alpha) * (mobile ? 7 : 11);
      scene.style.opacity = alpha.toFixed(3);
      // A blur filter on a fully transparent element still costs GPU/CPU time.
      scene.style.filter = (alpha < 0.002 || blur < 0.05) ? 'none' : `blur(${blur.toFixed(2)}px)`;
      scene.style.transform = innerWidth > 820
        ? `translate3d(0, calc(-50% + ${y}px), 0)`
        : `translate3d(0, ${y}px, 0)`;
      scene.classList.toggle('is-live', alpha > 0.5);
    });

    const tiltX = pointer.sy * (mobile ? 0.3 : 1.15) + scrollVelocity * 0.002;
    const tiltY = pointer.sx * (mobile ? 0.48 : 1.45);
    const z = Math.sin(p * Math.PI) * (mobile ? 8 : 18);
    const roll = (p - 0.5) * (mobile ? 0.35 : 0.75);
    filmCard.style.transform = `translate(-50%,-50%) perspective(1500px) translateZ(${z}px) rotateX(${tiltX}deg) rotateY(${tiltY - 2}deg) rotateZ(${roll}deg)`;
    if (filmShine) filmShine.style.transform = `translateX(${(-130 + p * 260).toFixed(1)}%)`;
  }

  function chapterProgress(metric, y) {
    return clamp((y - metric.top) / metric.span);
  }

  function updateInviteMotion(sectionRect) {
    if (!inviteStage || !inviteCard) return;
    const sectionVisible = clamp(1 - Math.abs(sectionRect.top + sectionRect.height * 0.5 - viewportH * 0.55) / viewportH, 0, 1);
    const tiltX = (-pointer.sy * (mobile ? 4 : 7)) * sectionVisible;
    const tiltY = (pointer.sx * (mobile ? 6 : 11)) * sectionVisible;
    const z = 18 * sectionVisible;
    inviteStage.style.transform = `perspective(1700px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateZ(${z}px)`;
    inviteCard.style.transform = `translateZ(${28 + z * 0.4}px)`;
    const shine = $('.invite-card__shine', inviteCard);
    if (shine) shine.style.transform = `translateX(${(-55 + (pointer.sx + 1) * 34).toFixed(1)}%) rotate(2deg)`;
  }

  function updateChapters(y) {
    let best = { idx: 0, dist: Infinity };
    let heartbeatWanted = false;

    chapterMetrics.forEach((metric) => {
      const p = chapterProgress(metric, y);
      const localCenter = Math.abs(p - 0.5);
      const inRange = y >= metric.top - viewportH * 0.45 && y <= metric.top + metric.span + viewportH * 0.45;
      if (inRange && localCenter < best.dist) best = { idx: metric.chapter, dist: localCenter };

      // Off-screen chapters are skipped. A chapter gets one final update on the
      // frame it leaves the zone, so it is left in its clamped end state.
      const near = y >= metric.top - viewportH * 1.2 && y <= metric.top + metric.height + viewportH * 0.2;
      if (!near && !metric.wasActive) return;
      metric.wasActive = near;

      if (metric.isChapter) {
        const contentA = fadeWindow(p, 0.1, 0.92, 0.14);
        const contentY = lerp(42, -26, p);
        const bgScale = lerp(1.12, 1.025, p);
        const bgX = (p - 0.5) * (mobile ? 1.2 : 2.8);
        const bgY = (p - 0.5) * (mobile ? -1.6 : -3.2);
        const numX = (p - 0.5) * (mobile ? 18 : 56);
        metric.el.style.setProperty('--content-alpha', contentA.toFixed(3));
        metric.el.style.setProperty('--content-y', `${contentY.toFixed(1)}px`);
        metric.el.style.setProperty('--content-blur', `${((1 - contentA) * 7).toFixed(1)}px`);
        metric.el.style.setProperty('--bg-scale', bgScale.toFixed(4));
        metric.el.style.setProperty('--bg-x', `${bgX.toFixed(2)}%`);
        metric.el.style.setProperty('--bg-y', `${bgY.toFixed(2)}%`);
        metric.el.style.setProperty('--num-x', `${numX.toFixed(1)}px`);
        metric.el.style.setProperty('--card-alpha', fadeWindow(p, 0.22, 0.86, 0.12).toFixed(3));

        const content = metric.content;
        if (content) {
          const ty = innerWidth > 820 ? `calc(-50% + ${contentY.toFixed(1)}px)` : `${contentY.toFixed(1)}px`;
          content.style.transform = `translate3d(0, ${ty}, 0)`;
        }

        if (metric.isCampus) {
          metric.el.style.setProperty('--steth-dash', `${(1500 * (1 - smoothstep(0.12, 0.62, p))).toFixed(0)}`);
          metric.el.style.setProperty('--steth-alpha', `${0.06 + smoothstep(0.18, 0.64, p) * 0.34}`);
          metric.el.style.setProperty('--steth-x', `${lerp(62, -18, p)}px`);
          metric.el.style.setProperty('--steth-y', `${lerp(-18, 44, p)}px`);
        }

        if (metric.isLearning) {
          metric.el.style.setProperty('--helix-alpha', `${fadeWindow(p, 0.12, 0.92, 0.18) * 0.92}`);
          drawHelix(p);
        }

        if (metric.isClinical) {
          const a = fadeWindow(p, 0.16, 0.88, 0.12);
          metric.el.style.setProperty('--monitor-alpha', a.toFixed(3));
          metric.el.style.setProperty('--monitor-y', `${lerp(-28, 18, p)}px`);
          metric.el.style.setProperty('--ecg-dash', `${(1100 * (1 - smoothstep(0.18, 0.72, p))).toFixed(0)}`);
          metric.el.style.setProperty('--beam-alpha', `${0.08 + a * 0.38}`);
          heartbeatWanted = a > 0.12;
        }

        if (metric.isGraduation) {
          drawConfetti(p, fadeWindow(p, 0.26, 0.94, 0.14));
        }

        metric.tilts.forEach((card, i) => {
          const a = fadeWindow(p, 0.18, 0.88, 0.15);
          const ry = (pointer.sx * (mobile ? 2.4 : 6)) + (p - 0.5) * (i ? 5 : -5);
          const rx = (-pointer.sy * (mobile ? 1.8 : 4)) + (0.5 - p) * 2;
          const ty = (0.5 - p) * (mobile ? 26 : 58);
          card.style.transform = `translate3d(0,${ty}px,${a * 34}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${i ? 1.5 : -1.6}deg)`;
        });
      }

      if (metric.isFinale) {
        // Computed from cached metrics instead of getBoundingClientRect(), which
        // forced a full layout every frame right after the style writes above.
        updateInviteMotion({ top: metric.top - y, height: metric.height });
      }
    });

    setHeartbeatWanted(heartbeatWanted);
    if (best.idx !== activeChapter) activeChapter = best.idx;
    railIndex.textContent = String(activeChapter).padStart(2, '0');
    railFill.style.height = `${clamp(y / docMaxScroll) * 100}%`;
  }

  const dctx = depthCanvas.getContext('2d');
  const particleCount = lowPower ? 60 : (mobile ? 100 : 160);
  const particles = Array.from({ length: particleCount }, () => ({
    x: Math.random() * 2 - 1,
    y: Math.random() * 2 - 1,
    z: Math.random(),
    size: 0.35 + Math.random() * 1.45,
    tone: Math.random()
  }));

  function resizeCanvas(canvas, ctx, dprCap = 1.5) {
    const dpr = Math.min(devicePixelRatio || 1, dprCap);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resizeCanvases() {
    resizeCanvas(depthCanvas, dctx, mobile ? 1.1 : 1.5);
    resizeCanvas(confettiCanvas, confettiCanvas.getContext('2d'), mobile ? 1 : 1.35);
    if (helixCanvas) resizeCanvas(helixCanvas, helixCanvas.getContext('2d'), mobile ? 1 : 1.25);
  }

  function drawDepth() {
    dctx.clearRect(0, 0, viewportW, viewportH);
    const heroA = 1 - smoothstep(0.94, 1, targetHeroP);
    const amount = mobile ? 0.54 : 0.8;
    const cx = viewportW * (0.5 + pointer.sx * 0.03);
    const cy = viewportH * (0.48 + pointer.sy * 0.022);
    const speedBias = Math.min(1, Math.abs(scrollVelocity) / 75);
    for (const p of particles) {
      const z = ((p.z + scrollY * 0.00005) % 1 + 1) % 1;
      const depth = 0.2 + z * 1.1;
      const x = cx + p.x * viewportW * depth * 0.64;
      const y = cy + p.y * viewportH * depth * 0.55;
      if (x < -20 || x > viewportW + 20 || y < -20 || y > viewportH + 20) continue;
      const a = (0.04 + z * 0.2) * amount * (0.75 + heroA * 0.25);
      const r = p.size * (0.42 + z * 1.45 + speedBias * 0.26);
      const gold = p.tone > 0.84;
      dctx.globalAlpha = gold ? a : a * 0.68;
      dctx.fillStyle = gold ? 'rgb(201,169,97)' : 'rgb(207,230,232)';
      dctx.beginPath();
      dctx.arc(x, y, r, 0, Math.PI * 2);
      dctx.fill();
    }
    dctx.globalAlpha = 1;
  }

  const hctx = helixCanvas?.getContext('2d');
  function drawHelix(p) {
    if (!helixCanvas || !hctx) return;
    const w = helixCanvas.clientWidth || 400;
    const h = helixCanvas.clientHeight || 500;
    hctx.clearRect(0, 0, w, h);
    const cx = w * 0.5;
    const radius = Math.min(w, h) * 0.19;
    const span = h * 0.86;
    const points = 40;
    const phase = p * Math.PI * 3.1;
    for (let i = 0; i < points; i += 1) {
      const t = i / (points - 1);
      const y = h * 0.07 + t * span;
      const a = phase + t * Math.PI * 5.5;
      const z1 = Math.sin(a);
      const z2 = Math.sin(a + Math.PI);
      const x1 = cx + Math.cos(a) * radius;
      const x2 = cx + Math.cos(a + Math.PI) * radius;
      if (i % 3 === 0) {
        hctx.beginPath();
        hctx.moveTo(x1, y);
        hctx.lineTo(x2, y);
        hctx.strokeStyle = 'rgba(213,233,235,.14)';
        hctx.lineWidth = 1;
        hctx.stroke();
      }
      [[x1, z1], [x2, z2]].forEach(([x, z], j) => {
        const r = 2.2 + (z + 1) * 2.1;
        const alpha = 0.22 + (z + 1) * 0.22;
        hctx.beginPath();
        hctx.arc(x, y, r, 0, Math.PI * 2);
        hctx.fillStyle = (i + j) % 5 === 0 ? `rgba(230,207,145,${alpha})` : `rgba(138,184,194,${alpha})`;
        hctx.shadowBlur = 10;
        hctx.shadowColor = hctx.fillStyle;
        hctx.fill();
        hctx.shadowBlur = 0;
      });
    }
  }

  const cctx = confettiCanvas.getContext('2d');
  const confetti = Array.from({ length: lowPower ? 55 : (mobile ? 100 : 165) }, (_, i) => ({
    x: Math.random(),
    y: Math.random() * -0.7,
    speed: 0.42 + Math.random() * 1.05,
    drift: (Math.random() - 0.5) * 0.22,
    rot: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 9,
    size: 4 + Math.random() * 8,
    gold: i % 4 === 0
  }));

  function drawConfetti(p, alpha) {
    cctx.clearRect(0, 0, viewportW, viewportH);
    if (alpha <= 0.005) return;
    const q = smoothstep(0.22, 0.88, p);
    for (const c of confetti) {
      const x = (c.x + c.drift * q + Math.sin((q + c.rot) * 5) * 0.018) * viewportW;
      const y = (c.y + q * c.speed * 1.75) * viewportH;
      if (y < -40 || y > viewportH + 40) continue;
      const rot = c.rot + q * c.spin;
      cctx.save();
      cctx.translate(x, y);
      cctx.rotate(rot);
      cctx.globalAlpha = alpha * 0.8;
      cctx.fillStyle = c.gold ? '#d9bb72' : '#d8d4ca';
      cctx.fillRect(-c.size * 0.5, -c.size * 0.26, c.size, c.size * 0.52);
      cctx.restore();
    }
  }

  const audio = { on: false, userMuted: false, heartbeatWanted: false, heartbeatPlaying: false, autoplayBlocked: false };
  const volumeAnimations = new WeakMap();
  if (backgroundMusic) backgroundMusic.volume = 0.23;
  if (heartbeatAudio) heartbeatAudio.volume = 0;

  function rampVolume(el, to, duration = 420) {
    if (!el) return;
    const previous = volumeAnimations.get(el);
    if (previous) cancelAnimationFrame(previous.raf);
    const from = el.volume;
    const started = performance.now();
    const state = { raf: 0 };
    const tick = (now) => {
      const p = clamp((now - started) / Math.max(1, duration));
      const eased = p * p * (3 - 2 * p);
      el.volume = clamp(lerp(from, to, eased), 0, 1);
      if (p < 1) state.raf = requestAnimationFrame(tick);
      else volumeAnimations.delete(el);
    };
    state.raf = requestAnimationFrame(tick);
    volumeAnimations.set(el, state);
  }

  async function startHeartbeat() {
    if (!heartbeatAudio || !audio.on || !audio.heartbeatWanted || audio.heartbeatPlaying) return;
    audio.heartbeatPlaying = true;
    try {
      heartbeatAudio.currentTime = 0;
      heartbeatAudio.volume = 0;
      await heartbeatAudio.play();
      rampVolume(backgroundMusic, 0.16, 520);
      rampVolume(heartbeatAudio, 0.38, 560);
    } catch {
      audio.heartbeatPlaying = false;
    }
  }

  function stopHeartbeat() {
    if (!heartbeatAudio || !audio.heartbeatPlaying) {
      if (audio.on) rampVolume(backgroundMusic, 0.23, 520);
      return;
    }
    audio.heartbeatPlaying = false;
    rampVolume(backgroundMusic, 0.23, 560);
    const was = heartbeatAudio;
    rampVolume(was, 0, 480);
    setTimeout(() => {
      if (!audio.heartbeatPlaying) {
        was.pause();
        try { was.currentTime = 0; } catch {}
      }
    }, 520);
  }

  function setHeartbeatWanted(wanted) {
    if (audio.heartbeatWanted === wanted) return;
    audio.heartbeatWanted = wanted;
    if (wanted) startHeartbeat();
    else stopHeartbeat();
  }

  async function enableAudio() {
    if (!backgroundMusic) return;
    audio.userMuted = false;
    backgroundMusic.muted = false;
    try {
      backgroundMusic.volume = audio.heartbeatWanted ? 0.16 : 0.23;
      await backgroundMusic.play();
      audio.on = true;
      audio.autoplayBlocked = false;
      soundButton?.setAttribute('aria-pressed', 'true');
      soundButton?.setAttribute('aria-label', 'قطع موسیقی و صدا');
      if (audio.heartbeatWanted) startHeartbeat();
    } catch {
      audio.on = false;
      audio.autoplayBlocked = true;
      soundButton?.setAttribute('aria-pressed', 'false');
    }
  }

  function disableAudio() {
    audio.userMuted = true;
    audio.on = false;
    backgroundMusic?.pause();
    if (heartbeatAudio) {
      heartbeatAudio.pause();
      heartbeatAudio.volume = 0;
      try { heartbeatAudio.currentTime = 0; } catch {}
    }
    audio.heartbeatPlaying = false;
    soundButton?.setAttribute('aria-pressed', 'false');
    soundButton?.setAttribute('aria-label', 'فعال‌سازی موسیقی و صدا');
  }

  async function tryAutoplayMusic() {
    if (!backgroundMusic || audio.userMuted) return;
    try {
      backgroundMusic.muted = false;
      backgroundMusic.volume = 0.23;
      await backgroundMusic.play();
      audio.on = true;
      audio.autoplayBlocked = false;
      soundButton?.setAttribute('aria-pressed', 'true');
      soundButton?.setAttribute('aria-label', 'قطع موسیقی و صدا');
    } catch {
      audio.autoplayBlocked = true;
    }
  }

  soundButton?.addEventListener('click', () => (audio.on ? disableAudio() : enableAudio()));

  const unlockAudioOnGesture = (event) => {
    if (soundButton && (event.target === soundButton || soundButton.contains(event.target))) return;
    if (!audio.userMuted && !audio.on) enableAudio().catch(() => {});
  };
  window.addEventListener('pointerdown', unlockAudioOnGesture, { passive: true, capture: true });
  window.addEventListener('touchstart', unlockAudioOnGesture, { passive: true, capture: true });
  window.addEventListener('keydown', unlockAudioOnGesture, { passive: true, capture: true });

  function updateAudio() {
    // File-based cinematic music remains continuous. Chapter-specific audio is
    // handled by setHeartbeatWanted() to keep ECG entry/exit deterministic.
  }

  function onScroll() {
    scrollY = window.scrollY;
    const delta = scrollY - lastScrollY;
    scrollVelocity = lerp(scrollVelocity, delta, 0.32);
    lastScrollY = scrollY;
    targetHeroP = heroProgressFromScroll(scrollY);
    topbar?.classList.toggle('is-scrolled', scrollY > 24);
    updateInvitationManualReadiness(scrollY);

  }

  function onPointer(e) {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
  }

  function animateCursor(e) {
    if (!cursor || coarse) return;
    cursor.style.transform = `translate3d(${e.clientX - 17}px,${e.clientY - 17}px,0)`;
  }

  function frameLoop() {
    stepAutoScroll(performance.now());
    smoothHeroP = reduceMotion ? targetHeroP : lerp(smoothHeroP, targetHeroP, mobile ? 0.27 : 0.18);
    pointer.sx = lerp(pointer.sx, pointer.x, 0.08);
    pointer.sy = lerp(pointer.sy, pointer.y, 0.08);
    scrollVelocity *= 0.88;

    if (!reduceMotion) applyHeroFrame();

    const settling =
      Math.abs(smoothHeroP - targetHeroP) > 1e-4 ||
      Math.abs(pointer.sx - pointer.x) > 1e-3 ||
      Math.abs(pointer.sy - pointer.y) > 1e-3 ||
      Math.abs(scrollVelocity) > 0.05;

    // When the page is still, the frame would be identical: skip the DOM/canvas work.
    if (needsRender || settling || scrollY !== lastRenderedScrollY) {
      updateHeroUI(smoothHeroP);
      updateChapters(scrollY);
      drawDepth();
      lastRenderedScrollY = scrollY;
      needsRender = false;
    }
    updateAudio();

    raf = requestAnimationFrame(frameLoop);
  }

  function initCursor() {
    if (coarse || !cursor) return;
    document.addEventListener('pointermove', (e) => {
      onPointer(e);
      animateCursor(e);
    }, { passive: true });
    $$('a,button').forEach((el) => {
      el.addEventListener('mouseenter', () => cursor.classList.add('hot'));
      el.addEventListener('mouseleave', () => cursor.classList.remove('hot'));
    });
  }

  function initLinks() {
    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        const target = id && $(id);
        if (!target) return;
        e.preventDefault();
        const y = target.getBoundingClientRect().top + window.scrollY;
        seekAutoScroll(y);
      });
    });
  }

  function initMailEntrance() {
    if (!mailIntro || !mailEnvelope || !mailCard || !mailSeal) {
      body.classList.remove('invitation-locked');
      body.classList.add('invitation-entered');
      startAutoScroll({ reset: true, force: true });
      return;
    }

    let opening = false;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reduceMotion ? Math.min(ms, 30) : ms));

    function waxChips() {
      const box = mailSeal.getBoundingClientRect();
      const count = lowPower ? 5 : 9;
      for (let i = 0; i < count; i += 1) {
        const chip = document.createElement('i');
        chip.className = 'mail-wax-chip';
        chip.style.left = `${box.left + box.width / 2 - 3}px`;
        chip.style.top = `${box.top + box.height / 2 - 3}px`;
        document.body.appendChild(chip);
        const angle = Math.random() * Math.PI * 2;
        const distance = 20 + Math.random() * 42;
        const rot = (Math.random() - 0.5) * 220;
        try {
          if (typeof chip.animate === 'function' && !reduceMotion) {
            chip.animate([
              { transform: 'translate(0,0) rotate(0) scale(1)', opacity: .92 },
              { transform: `translate(${Math.cos(angle) * distance}px,${Math.sin(angle) * distance + 20}px) rotate(${rot}deg) scale(.25)`, opacity: 0 }
            ], { duration: 560 + Math.random() * 150, easing: 'cubic-bezier(.14,.72,.2,1)' });
          } else {
            chip.style.opacity = '0';
          }
        } catch {
          chip.style.opacity = '0';
        }
        setTimeout(() => chip.remove(), reduceMotion ? 40 : 800);
      }
    }

    function sealTactileFx() {
      try {
        navigator.vibrate?.(18);
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(145, now);
        osc.frequency.exponentialRampToValueAtTime(58, now + .12);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.exponentialRampToValueAtTime(.028, now + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, now + .16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now); osc.stop(now + .18);
        setTimeout(() => { try { ctx.close(); } catch {} }, 400);
      } catch {}
    }

    async function runAnimation(el, keyframes, options = {}) {
      if (!el) return null;
      const lastFrame = keyframes[keyframes.length - 1] || {};
      const duration = reduceMotion ? 1 : Number(options.duration || 0);
      const delay = reduceMotion ? 0 : Number(options.delay || 0);
      const safeOptions = { ...options, duration, delay };
      if (reduceMotion || typeof el.animate !== 'function') {
        Object.entries(lastFrame).forEach(([key, value]) => {
          if (key !== 'offset' && key !== 'easing' && key !== 'composite') el.style[key] = value;
        });
        if (duration + delay > 1) await wait(duration + delay);
        return null;
      }
      try {
        const animation = el.animate(keyframes, safeOptions);
        await withTimeout(animation.finished.catch(() => false), duration + delay + 350);
        return animation;
      } catch {
        Object.entries(lastFrame).forEach(([key, value]) => {
          if (key !== 'offset' && key !== 'easing' && key !== 'composite') el.style[key] = value;
        });
        return null;
      }
    }

    let entranceFinished = false;
    async function finishEntrance() {
      if (entranceFinished) return;
      entranceFinished = true;
      try { mailIntro?.getAnimations?.({ subtree: true }).forEach((a) => a.cancel()); } catch {}
      // The video has been warming since initial page parse. Before handing the
      // page to auto-scroll, make sure at least one decodable frame is available.
      // This wait is bounded and runs behind the envelope animation, so it is
      // normally invisible to the visitor.
      await ensureHeroVideoReadyForStory(5000).catch(() => false);
      try { mailCard?.getAnimations?.().forEach((a) => a.cancel()); } catch {}
      try { mailCard?.remove(); } catch {}
      try { mailIntro?.remove(); } catch {}
      body.classList.remove('invitation-locked', 'invitation-opening');
      body.classList.add('invitation-entered');
      window.scrollTo(0, 0);
      syncAutoScrollTo(0);
      targetHeroP = 0; smoothHeroP = 0; targetFrame = 0; displayedFrame = 0; lastAppliedFrame = -1;
      if (heroReady) { try { heroVideo.pause(); heroVideo.currentTime = 0; } catch {} }
      startAutoScroll({ reset: true, force: true });
    }

    async function openMail(event) {
      event?.preventDefault?.();
      if (opening || entranceFinished) return;
      opening = true;
      mailSeal.disabled = true;
      body.classList.add('invitation-opening');
      window.scrollTo(0, 0);
      syncAutoScrollTo(0);
      void enableAudio().catch(() => {});
      sealTactileFx();

      try {
        mailSeal.classList.add('is-cracking');
        await wait(150);
        mailSeal.classList.add('is-released');
        waxChips();
        await wait(190);

        mailEnvelope.classList.add('is-open');
        await wait(520);

        const envH = Math.max(1, mailEnvelope.getBoundingClientRect().height);
        const compact = innerWidth <= 820;
        const y1 = -envH * (compact ? .47 : .50);
        const y2 = -envH * (compact ? .91 : .94);
        const anim1 = await runAnimation(mailCard, [
          { transform: 'translateY(0) scale(1)' },
          { transform: `translateY(${y1}px) scale(1.006)` }
        ], { duration: 620, easing: 'cubic-bezier(.17,.78,.18,1)', fill: 'forwards' });
        try { anim1?.cancel(); } catch {}
        mailCard.style.transform = `translateY(${y1}px) scale(1.006)`;

        const anim2 = await runAnimation(mailCard, [
          { transform: `translateY(${y1}px) scale(1.006)` },
          { transform: `translateY(${y2}px) scale(1.025)` }
        ], { duration: 500, easing: 'cubic-bezier(.16,.8,.16,1)', fill: 'forwards' });
        try { anim2?.cancel(); } catch {}
        mailCard.style.transform = `translateY(${y2}px) scale(1.025)`;
        mailCard.classList.add('is-free', 'is-shimmering');
        await wait(220);

        const rect = mailCard.getBoundingClientRect();
        document.body.appendChild(mailCard);
        Object.assign(mailCard.style, {
          position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
          right: 'auto', bottom: 'auto', transform: 'none', margin: '0', zIndex: '1300'
        });
        mailCard.classList.add('is-world');
        void mailCard.offsetWidth;
        mailCard.classList.add('is-fullscreen');
        mailIntro.classList.add('is-departing');

        const expandPromise = runAnimation(mailCard, [
          { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: '13px' },
          { left: '0px', top: '0px', width: `${innerWidth}px`, height: `${innerHeight}px`, borderRadius: '0px' }
        ], { duration: 850, easing: 'cubic-bezier(.16,.82,.14,1)', fill: 'forwards' });
        const fadePromise = runAnimation(mailIntro, [
          { opacity: 1 }, { opacity: .08 }
        ], { duration: 720, delay: 120, easing: 'ease-in', fill: 'forwards' });
        await Promise.allSettled([expandPromise, fadePromise]);

        await wait(320);
        body.classList.add('invitation-entered');
        await runAnimation(mailCard, [
          { opacity: 1, filter: 'blur(0)' },
          { opacity: 0, filter: 'blur(5px)' }
        ], { duration: 560, easing: 'cubic-bezier(.44,0,.72,.24)', fill: 'forwards' });
      } catch (error) {
        console.warn('[MAZUMS] Mail entrance recovered from an animation/media error:', error);
      } finally {
        await finishEntrance();
      }
    }

    mailSeal.addEventListener('click', openMail);
    mailSeal.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') openMail(e);
    }, { passive: false });
    mailSeal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMail(e); }
    });

    if (!coarse && !reduceMotion) {
      mailIntro.addEventListener('pointermove', (e) => {
        if (opening) return;
        const r = mailStage.getBoundingClientRect();
        const nx = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * 2 - 1;
        const ny = clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1) * 2 - 1;
        mailEnvelope.style.transform = `perspective(1600px) rotateX(${-ny * 1.8}deg) rotateY(${nx * 2.5}deg) rotateZ(${-0.35 + nx * .16}deg) translate3d(${nx * 2}px,${ny * 1.5}px,0)`;
      }, { passive: true });
      mailIntro.addEventListener('pointerleave', () => { if (!opening) mailEnvelope.style.transform = ''; }, { passive: true });
    }

    const params = new URLSearchParams(location.search);
    if (params.get('entrance') === 'skip') {
      mailIntro.remove();
      body.classList.remove('invitation-locked');
      body.classList.add('invitation-entered');
      startAutoScroll({ reset: true, force: true });
    }
  }

  async function init() {
    const startedAt = performance.now();
    setLoader(.04, 'در حال تحلیل مدیای آغازین…');
    const boot = { visuals: 0, fonts: 0 };
    const paintBoot = (status) => {
      const progress = .04 + boot.visuals * .62 + boot.fonts * .30;
      setLoader(Math.min(.96, progress), status);
    };

    // The hero video starts streaming now but no longer blocks the loader.
    // The envelope intro gives it time; finishEntrance() waits for it if needed.
    if (!reduceMotion) void bindVideoSource();

    const visualsTask = preloadCriticalAssets((p) => {
      boot.visuals = p;
      paintBoot(p < 1 ? 'در حال رمزگشایی تصاویر اصلی…' : 'تصاویر اصلی آماده شدند');
    });

    const fontsTask = waitForFonts((p) => {
      boot.fonts = p;
      paintBoot(p < 1 ? 'در حال آماده‌سازی تایپوگرافی…' : 'تایپوگرافی آماده شد');
    });

    await Promise.allSettled([withTimeout(visualsTask, 4000), withTimeout(fontsTask, 2500)]);

    // Keep a short minimum duration only to avoid a flash on warm-cache revisits.
    const minimumPresentationMs = 520;
    const remaining = Math.max(0, minimumPresentationMs - (performance.now() - startedAt));
    if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));

    setLoader(.985, 'هماهنگ‌سازی صحنه‌ها و حرکت…');
    computeMetrics();
    initCursor();
    initAutoScroll();
    initLinks();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', () => {
      const y = window.scrollY;
      computeMetrics();
      buildAutoScrollTimeline();
      syncAutoScrollTo(y);
      targetHeroP = heroProgressFromScroll(window.scrollY);
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        heroVideo.pause();
        backgroundMusic?.pause();
        heartbeatAudio?.pause();
        if (audio.heartbeatPlaying) audio.heartbeatPlaying = false;
      } else {
        autoScroll.lastTime = performance.now();
        if (audio.on && !audio.userMuted) {
          backgroundMusic?.play().catch(() => {});
          if (audio.heartbeatWanted) startHeartbeat();
        }
      }
    });

    onScroll();
    if (reduceMotion) {
      heroVideo.poster = 'assets/hero-poster.webp';
      try { heroVideo.currentTime = 0; } catch {}
    }

    initMailEntrance();
    closeLoader();
    requestAnimationFrame(() => {
      onScroll();
      frameLoop();
    });
    // Let the loader fade-out finish before background image loading starts,
    // so the two don't compete for the same frames.
    setTimeout(() => {
      initSectionWarmObserver();
      warmVisualAssets();
    }, 1200);
  }

  init().catch((error) => {
    console.error('[MAZUMS] Initialization failed', error);
    try { mailIntro?.remove(); } catch {}
    body.classList.remove('invitation-locked', 'invitation-opening', 'auto-scroll-mode', 'auto-scroll-running');
    body.classList.add('invitation-entered', 'manual-scroll-accessibility');
    autoScroll.active = false;
    autoScroll.paused = false;
    autoScroll.ended = true;
    closeLoader();
  });
})();
