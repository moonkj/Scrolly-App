// content.js – AutoWebScroller v1.1  (Safari Web Extension API)

(() => {
  // ─── State ───────────────────────────────────────────────────────────────────
  let scrollInterval = null;
  let isScrolling    = false;

  let settings = {
    speed:            3,
    speedMode:        'curve',    // 'curve' (s²×9 px/s) | 'linear' (s×20 px/s)
    direction:        'down',
    loop:             false,
    autoPause:        true,
    timerMins:        0,
    gestureShortcuts: true,
    showWidget:       true,
    widgetOrientation:'vertical', // 'vertical' | 'horizontal'
    seriesMode:       false,      // auto-resume scroll on page navigation
  };

  let timerTimeout = null;

  // Auto-pause
  let userScrolling   = false;
  let userScrollTimer = null;

  // Gesture shortcuts
  let tapCount             = 0;
  let lastTapTime          = 0;
  let tapTimeout           = null;
  let gestureInhibitUntil  = 0;  // inhibit gestures briefly after popup interaction

  // Scroll engine
  let scrollTarget       = null;  // cached scroll target element
  let lastRafTime        = null;  // for delta-time calculation
  let spaCheckTimer      = 0;     // throttle: SPA widget re-inject check every 120 frames
  let scrollTargetTimer  = 0;     // throttle: re-detect scroll container every 300 frames (~5s)

  // Widget
  let widget              = null;
  let widgetPlayBtn       = null;  // direct reference to avoid getElementById miss
  let widgetCollapsed     = false;
  let cachedWidgetPos     = null;  // global position loaded from browser.storage.local (cross-site)
  let darkModeListener    = null;  // stored ref to prevent duplicate matchMedia listeners
  let isDragging      = false;
  let dragMoved       = false;
  let dragStartX      = 0, dragStartY  = 0;
  let dragOrigLeft    = 0, dragOrigTop = 0;
  let _keepalivePort  = null;    // port to detect extension disable

  // Series mode: set true when scroll stops naturally at page end (not by user action).
  // Allows onNavigate / pagehide to resume scroll on the next page even though
  // isScrolling is already false by the time navigation fires.
  let seriesResumeIntent = false;

  // SPA navigation re-inject/resume timer. Tracked so rapid back-to-back navigations
  // (e.g. router redirect: replaceState→pushState) don't stack multiple timers.
  let navigateTimer   = null;
  let pendingResume   = false;

  // RAF generation token. Every scroll-loop start bumps this; each doScroll frame
  // carries the generation it was scheduled under and self-terminates when it no
  // longer matches. This guarantees only ONE doScroll chain is ever alive — even if
  // a stray second chain gets scheduled (bfcache restore, series auto-resume race,
  // autoPause resume race), stopScroll bumps the token and every live chain dies on
  // its next frame. Fixes "stop doesn't stop / button mismatch / jittery scroll".
  let scrollGeneration = 0;

  // Wake Lock
  let wakeLock = null;

  // Storage keys
  const SETTINGS_KEY         = 'aws_settings';
  const WIDGET_POS_KEY       = `aws_widget_pos_${location.hostname}`;
  const WIDGET_POS_GLOBAL_KEY = 'aws_widget_pos';
  const WIDGET_COLLAPSED_KEY  = 'aws_widget_collapsed';

  // Whitelist of allowed settings keys — single source of truth (prevents prototype pollution
  // and avoids drift between popup/content). Used wherever a settings object is merged in.
  const SETTINGS_KEYS = [
    'speed','speedMode','direction','loop','autoPause','timerMins',
    'gestureShortcuts','showWidget','widgetOrientation','seriesMode'
  ];

  // End-of-page stuck detection (prevents apparent "auto-restart" on infinite-scroll pages
  // where lazy-loaded content makes scrollBy resume after reaching the bottom).
  let lastScrollPos = -1;
  let stuckFrames   = 0;
  let scrollStartedAt = 0; // timestamp of last startScroll — explicit end check grace period

  // ─── Tunable Constants ────────────────────────────────────────────────────────
  const STUCK_FRAMES_THRESHOLD       = 180;   // ~3s @ 60fps — auto-stop after sustained no movement
  const SPA_CHECK_FRAMES             = 120;   // ~2s — re-inject widget if removed by SPA
  const SCROLL_TARGET_RECHECK_FRAMES = 300;   // ~5s — re-detect scroll target on infinite-scroll pages
  const RAF_DELTA_TIME_CAP_MS        = 100;   // cap delta-time to prevent jump after tab switch
  const AUTOPAUSE_RESUME_DELAY_MS    = 3000;  // resume scroll 3s after user touches stop
  const GESTURE_INHIBIT_MS           = 800;   // disable gesture shortcuts after popup interaction
  const MULTI_TAP_WINDOW_MS          = 500;   // double/triple tap detection window
  const KEEPALIVE_RECONNECT_MS       = 1500;  // delay before reconnecting keepalive port
  const SPA_REINJECT_DELAY_MS        = 300;   // delay after SPA navigation before widget re-creation
  const STUCK_VIEWPORT_PADDING_PX    = 10;    // page must exceed viewport by this margin to enable stuck detection
  const SCROLL_LOOP_EDGE_TOLERANCE   = 2;     // px tolerance for "at edge" detection
  const SERIES_INTENT_KEY            = 'aws_series_intent'; // cross-page series mode intent
  const SERIES_INTENT_TTL_MS         = 30000; // intent valid for 30s after page unload

  // ─── Wake Lock ────────────────────────────────────────────────────────────────

  async function acquireWakeLock() {
    try {
      if (!('wakeLock' in navigator)) return;
      if (wakeLock) return;  // already held — avoid duplicate acquisition & reference leak
      const lock = await navigator.wakeLock.request('screen');
      if (!isScrolling) { lock.release(); return; }  // stopped before async resolved
      wakeLock = lock;
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) {}
  }

  function releaseWakeLock() {
    try { wakeLock?.release(); } catch (_) {}
    wakeLock = null;
  }

  // ─── Settings persistence (global, auto-save) ─────────────────────────────────

  function loadSiteSettings() {
    // Sync: read from current page's localStorage (fast, same-domain)
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k of SETTINGS_KEYS) {
          if (k in parsed) settings[k] = parsed[k];
        }
      }
    } catch (_) {}
    // Sync: restore widget collapsed state
    try {
      if (localStorage.getItem(WIDGET_COLLAPSED_KEY) === '1') widgetCollapsed = true;
    } catch (_) {}
    // Async: override with extension storage (cross-domain, survives navigation).
    // NOTE on widgetCollapsed: we deliberately DO NOT cross-domain-sync this state.
    // collapsed is stored only per-origin (localStorage above) — otherwise an accidental
    // collapse on one site would shrink the widget on every other site the user visits.
    try {
      const p = browser.storage?.local?.get([SETTINGS_KEY, WIDGET_POS_GLOBAL_KEY, SERIES_INTENT_KEY]);
      if (p) p.then(result => {
        if (result?.[SETTINGS_KEY]) {
          const stored = result[SETTINGS_KEY];
          for (const k of SETTINGS_KEYS) {
            if (k in stored) settings[k] = stored[k];
          }
          // Cross-domain navigation: localStorage was per-origin so the sync read above
          // missed our quit state. If the user has quit (showWidget=false), tear down any
          // widget that was already created speculatively by the init fallback below.
          if (!settings.showWidget && widget) {
            widget.remove();
            widget = null;
            widgetPlayBtn = null;
          }
          notifyState(); // Sync popup if open
        }
        if (result?.[WIDGET_POS_GLOBAL_KEY]) {
          const raw = result[WIDGET_POS_GLOBAL_KEY];
          if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) cachedWidgetPos = raw;
        }
        // Series mode: auto-start if there is a fresh intent saved by the previous page.
        // Intent is one-shot — clear immediately to prevent stale restarts on further navigations.
        if (settings.seriesMode && result?.[SERIES_INTENT_KEY]) {
          const intent = result[SERIES_INTENT_KEY];
          if (Number.isFinite(intent?.ts) && Date.now() - intent.ts < SERIES_INTENT_TTL_MS) {
            try {
              const rp = browser.storage?.local?.remove(SERIES_INTENT_KEY);
              if (rp) rp.catch(() => {});
            } catch (_) {}
            setTimeout(startScroll, SPA_REINJECT_DELAY_MS);
          }
        }
        // Try to create the widget now that cachedWidgetPos is ready (no-op if already exists)
        if (!widget && settings.showWidget) showWidget();
      }).catch(() => {});
    } catch (_) {}
  }

  function autoSaveSettings() {
    const snap = { ...settings };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(snap)); } catch (_) {}
    // Also persist to extension storage so settings survive across domains
    try {
      const p = browser.storage?.local?.set({ [SETTINGS_KEY]: snap });
      if (p) p.catch(() => {});
    } catch (_) {}
  }

  // ─── Extension keepalive (widget cleanup on extension disable) ───────────────

  function _connectKeepalive() {
    try {
      _keepalivePort = browser.runtime.connect({ name: 'keepalive' });
      _keepalivePort.onDisconnect.addListener(() => {
        _keepalivePort = null;
        // Attempt reconnect after 1.5s to allow background restart
        setTimeout(() => {
          try {
            _connectKeepalive(); // succeeds if extension still enabled
          } catch (_) {
            // Extension disabled — remove widget from DOM
            if (widget) { widget.remove(); widget = null; widgetPlayBtn = null; }
          }
        }, KEEPALIVE_RECONNECT_MS);
      });
    } catch (_) {
      // connect() failed immediately — extension disabled
      if (widget) { widget.remove(); widget = null; widgetPlayBtn = null; }
    }
  }

  // ─── Scroll Target Detection ──────────────────────────────────────────────────

  function getScrollTarget() {
    // Prefer the page itself when it has scrollable content.
    // This prevents inner containers (comment sections, feed items, sidebars, etc.)
    // that happen to be at the viewport centre from being picked as the target —
    // which would make the page appear to scroll slowly or not at all.
    if (document.documentElement.scrollHeight > window.innerHeight + 1) {
      return document.documentElement;
    }
    // Page is not scrollable (fixed-height SPA viewport) — find the inner container.
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    let el = document.elementFromPoint(cx, cy);
    let depth = 0;
    // Depth limit guards against pathological DOM nesting (>50 levels)
    while (el && el !== document.documentElement && depth < 50) {
      const style    = getComputedStyle(el);
      const overflow = style.overflow + style.overflowY;
      if ((overflow.includes('auto') || overflow.includes('scroll')) &&
          el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
      depth++;
    }
    return document.documentElement;
  }

  // ─── Scroll Loop ──────────────────────────────────────────────────────────────

  // Speed curve (pixels per second):
  //   curve  — quadratic: s²×9   (1→9, 3→81, 5→225, 10→900, 20→3600)
  //   linear — linear:    s×20   (1→20, 3→60, 5→100, 10→200, 20→400)
  function speedToPps(s) {
    return settings.speedMode === 'linear' ? s * 20 : s * s * 9;
  }

  // Schedule the next doScroll frame under a fresh generation token. All scroll-loop
  // (re)starts go through here so the generation is managed in one place.
  function _rafScroll() {
    const gen = ++scrollGeneration;
    return requestAnimationFrame((ts) => doScroll(ts, gen));
  }

  function doScroll(timestamp, gen) {
    // Terminate if scrolling stopped OR this frame belongs to a superseded chain.
    if (!isScrolling || gen !== scrollGeneration) return;

    // SPA self-heal: throttled to avoid per-frame getElementById
    if (settings.showWidget && ++spaCheckTimer >= SPA_CHECK_FRAMES) {
      spaCheckTimer = 0;
      if (!document.getElementById('__aws_widget__')) {
        widget = null; widgetPlayBtn = null; // reset stale JS refs before recreating
        createWidget();
      }
    }

    // scrollTarget re-detection: throttled, for infinite-scroll sites.
    // Only switch when the current target has reached the scroll edge in the direction
    // of travel — otherwise a mid-page scrollable div (e.g. comments section) would
    // hijack the target and the page would appear to slow down / stop.
    if (++scrollTargetTimer >= SCROLL_TARGET_RECHECK_FRAMES) {
      scrollTargetTimer = 0;
      const st = scrollTarget;
      const isRoot       = st === document.documentElement;
      const scrollTop    = isRoot ? window.scrollY              : st.scrollTop;
      const scrollHeight = isRoot ? document.body.scrollHeight  : st.scrollHeight;
      const clientHeight = isRoot ? window.innerHeight          : st.clientHeight;
      const atEdge = settings.direction === 'down'
        ? scrollTop + clientHeight >= scrollHeight - SCROLL_LOOP_EDGE_TOLERANCE
        : scrollTop <= SCROLL_LOOP_EDGE_TOLERANCE;
      if (atEdge) {
        const newTarget = getScrollTarget();
        if (newTarget !== scrollTarget) {
          try { scrollTarget.style.setProperty('will-change', 'auto'); } catch (_) {}
          scrollTarget = newTarget;
          try { scrollTarget.style.setProperty('will-change', 'scroll-position'); } catch (_) {}
          // H1 fix: skip scrollBy on the same frame as a target switch.
          // iOS Safari does not update scrollTop/scrollHeight synchronously after scrollBy,
          // so reading state on the next frame is more reliable.
          lastRafTime    = null;
          lastScrollPos  = -1;
          stuckFrames    = 0;
          scrollInterval = requestAnimationFrame((ts) => doScroll(ts, gen));
          return;
        }
      }
    }

    // autoPause: user is touching — stop the RAF loop to save battery.
    // The resume timer (in onTouchEnd / onUserWheel) will restart it.
    if (userScrolling && settings.autoPause) {
      scrollInterval = null;
      lastRafTime    = null; // reset so resume starts smoothly
      return;
    }

    // Delta-time: consistent px/second regardless of frame rate
    if (lastRafTime === null) lastRafTime = timestamp;
    const dt = Math.min(timestamp - lastRafTime, RAF_DELTA_TIME_CAP_MS); // cap 100ms (tab-switch protection)
    lastRafTime = timestamp;

    const pps   = speedToPps(settings.speed);
    const delta = (settings.direction === 'down' ? pps : -pps) * dt / 1000;
    // Sample current position before scrollBy (for stuck detection AND end-of-page check)
    const stRoot     = scrollTarget === document.documentElement;
    const beforePos  = stRoot ? window.scrollY : scrollTarget.scrollTop;

    // Explicit end-of-page check (loop disabled): stop the moment we hit the bottom
    // (or top) instead of relying solely on stuck detection.
    //
    // Grace period: skip the check for the first 300ms after startScroll. This protects
    // against false-positive stops when the user starts on a page that's already at the
    // end (the reposition in startScroll may not have taken effect yet — iOS Safari may
    // delay window.scrollTo updates until the next layout pass).
    if (!settings.loop && Date.now() - scrollStartedAt > 300) {
      const cliH = stRoot ? window.innerHeight : scrollTarget.clientHeight;
      const scrH = scrollTarget.scrollHeight;
      if (settings.direction === 'down' && beforePos + cliH >= scrH - SCROLL_LOOP_EDGE_TOLERANCE && scrH > cliH + STUCK_VIEWPORT_PADDING_PX) {
        if (settings.seriesMode) seriesResumeIntent = true;
        stopScroll();
        return;
      }
      if (settings.direction === 'up' && beforePos <= SCROLL_LOOP_EDGE_TOLERANCE && scrH > cliH + STUCK_VIEWPORT_PADDING_PX) {
        if (settings.seriesMode) seriesResumeIntent = true;
        stopScroll();
        return;
      }
    }

    // scrollBy: relative write, no implicit layout read (unlike scrollTop +=)
    scrollTarget.scrollBy(0, delta);

    if (settings.loop) {
      const st = scrollTarget;
      const isRoot     = st === document.documentElement;
      const scrollTop  = isRoot ? window.scrollY    : st.scrollTop;
      const clientH    = isRoot ? window.innerHeight : st.clientHeight;
      const scrollH    = st.scrollHeight;
      if (settings.direction === 'down' && scrollTop + clientH >= scrollH - SCROLL_LOOP_EDGE_TOLERANCE) {
        isRoot ? window.scrollTo(0, 0) : (st.scrollTop = 0);
        lastScrollPos = -1; stuckFrames = 0;
      } else if (settings.direction === 'up' && scrollTop <= SCROLL_LOOP_EDGE_TOLERANCE) {
        isRoot ? window.scrollTo(0, scrollH) : (st.scrollTop = scrollH);
        lastScrollPos = -1; stuckFrames = 0;
      }
    } else {
      // Stuck detection: only when loop is disabled AND the page is meaningfully scrollable.
      // If the page has no scrollable content (scrollHeight ≈ viewport), we skip the
      // detection — otherwise tests/jsdom and "no-scroll" pages would falsely trigger stop.
      // If the page IS scrollable and we've been stuck at the same position for
      // STUCK_FRAMES_THRESHOLD frames (~3s @ 60fps), we treat it as end-of-page and stop.
      // This prevents the apparent "auto-restart" behavior on infinite-scroll pages
      // where lazy-loaded content makes scrollBy resume after reaching the bottom.
      const totalH = stRoot ? document.documentElement.scrollHeight : scrollTarget.scrollHeight;
      const viewH  = stRoot ? window.innerHeight                     : scrollTarget.clientHeight;
      if (totalH > viewH + STUCK_VIEWPORT_PADDING_PX) {
        if (beforePos === lastScrollPos) {
          stuckFrames++;
          if (stuckFrames >= STUCK_FRAMES_THRESHOLD) {
            if (settings.seriesMode) seriesResumeIntent = true;
            stopScroll();
            return;
          }
        } else {
          stuckFrames   = 0;
          lastScrollPos = beforePos;
        }
      }
    }

    scrollInterval = requestAnimationFrame((ts) => doScroll(ts, gen));
  }

  // ─── Start / Stop / Toggle ────────────────────────────────────────────────────

  // Called when the scroll timer fires naturally (not user-initiated stop).
  // Resets timerMins to 0 so the popup/storage reflects "no timer" state.
  function onTimerExpired() {
    // Timer expiry is an explicit user-intended stop — it is NOT an end-of-page event,
    // so clear any series resume intent that a near-simultaneous end check may have set.
    seriesResumeIntent = false;
    settings.timerMins = 0;
    autoSaveSettings();
    stopScroll();
  }

  function startScroll() {
    if (isScrolling) return;
    isScrolling        = true;
    seriesResumeIntent = false; // consumed — clear so stale intent can't fire again
    userScrolling      = false; // clear any stale autoPause state
    clearTimeout(userScrollTimer); // drop any pending autoPause resume timer
    userScrollTimer    = null;
    lastRafTime        = null;
    spaCheckTimer      = 0;
    scrollTargetTimer  = 0;
    lastScrollPos      = -1;
    stuckFrames        = 0;
    scrollStartedAt    = Date.now(); // grace period anchor for explicit end-of-page check
    scrollTarget       = getScrollTarget();
    // Hint to browser compositor to pre-render scroll tiles
    try { scrollTarget.style.setProperty('will-change', 'scroll-position'); } catch (_) {}
    // NOTE: we intentionally do NOT force-enable the widget here.
    // If the user has quit (showWidget=false) and restarts via popup "start" button,
    // the popup sends updateSettings with showWidget=true before start — so the widget
    // appears correctly. But if startScroll is triggered by a gesture double-tap, the
    // user did NOT intend to re-enable the widget. Forcing it on here caused the
    // "widget resurrection on zoom/navigation" bug (v1.0.3 builds 4-7).
    // Reposition: if user starts while already at the end of the scroll, jump to the
    // opposite edge so the scroll has somewhere to go. Without this, doScroll's explicit
    // end-of-page check would immediately stop on the first frame.
    if (!settings.loop) {
      const isRoot = scrollTarget === document.documentElement;
      const sTop   = isRoot ? window.scrollY : scrollTarget.scrollTop;
      const cliH   = isRoot ? window.innerHeight : scrollTarget.clientHeight;
      const scrH   = scrollTarget.scrollHeight;
      try {
        if (settings.direction === 'down' && sTop + cliH >= scrH - SCROLL_LOOP_EDGE_TOLERANCE) {
          if (isRoot) window.scrollTo(0, 0); else scrollTarget.scrollTop = 0;
        } else if (settings.direction === 'up' && sTop <= SCROLL_LOOP_EDGE_TOLERANCE) {
          if (isRoot) window.scrollTo(0, scrH); else scrollTarget.scrollTop = scrH;
        }
      } catch (_) {} // jsdom doesn't implement window.scrollTo
    }
    scrollInterval = _rafScroll();
    if (settings.timerMins > 0) {
      timerTimeout = setTimeout(onTimerExpired, settings.timerMins * 60 * 1000);
    }
    acquireWakeLock();
    updateWidgetUI();
    notifyState();
  }

  function stopScroll() {
    if (!isScrolling) return;
    isScrolling  = false;
    lastRafTime  = null;
    // Bump generation so ANY live doScroll chain (including a stray second one that
    // cancelAnimationFrame below can't reach) self-terminates on its next frame.
    scrollGeneration++;
    cancelAnimationFrame(scrollInterval); scrollInterval = null;
    clearTimeout(timerTimeout);           timerTimeout   = null;
    clearTimeout(userScrollTimer);        userScrollTimer = null;
    userScrolling = false;
    // Inhibit gesture shortcuts briefly so an accidental double-tap on page content
    // (e.g. user trying to zoom or read) immediately after auto-stop does not toggle
    // the scroll back on. Same window as the popup-interaction inhibit.
    gestureInhibitUntil = Date.now() + GESTURE_INHIBIT_MS;
    try { if (scrollTarget) scrollTarget.style.setProperty('will-change', 'auto'); } catch (_) {}
    releaseWakeLock();
    updateWidgetUI();
    notifyState();
  }

  function toggleScroll() { isScrolling ? stopScroll() : startScroll(); }

  // Quit: full shutdown — stop scroll, remove widget DOM, persist showWidget=false
  // so the widget does not reappear on navigation/reload. User must explicitly start
  // again from the popup to bring it back.
  function quitScroll() {
    if (isScrolling) stopScroll();
    if (widget) { widget.remove(); widget = null; widgetPlayBtn = null; }
    settings.showWidget = false;
    autoSaveSettings();
    notifyState();
  }

  // ─── Notify Popup via background relay ────────────────────────────────────────

  function notifyState() {
    browser.runtime.sendMessage({ name: 'stateChanged', isScrolling, settings })
      .catch(() => {}); // popup might be closed
  }

  // ─── Wake Lock: re-acquire when tab regains focus ─────────────────────────────
  // The Wake Lock API automatically releases the lock when the page is hidden.
  // Listening to visibilitychange lets us re-acquire it when the user returns.

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isScrolling) acquireWakeLock();
  });

  // ─── Enhanced Auto-pause ──────────────────────────────────────────────────────

  window.addEventListener('wheel',      onUserWheel,  { passive: true });
  window.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchend',   onTouchEnd,   { passive: false });
  window.addEventListener('touchmove',  onTouchMove,  { passive: false });

  function onUserWheel() {
    if (!settings.autoPause) return;
    userScrolling = true;
    clearTimeout(userScrollTimer);
    userScrollTimer = setTimeout(() => {
      userScrolling = false;
      if (isScrolling && scrollInterval === null) scrollInterval = _rafScroll();
    }, AUTOPAUSE_RESUME_DELAY_MS);
  }

  function onTouchStart(e) {
    const onWidget = widget && widget.contains(e.target);
    if (settings.autoPause && !onWidget) {
      userScrolling = true;
      clearTimeout(userScrollTimer);
    }
    if (e.touches.length === 1) handleGestureTap(e);
    if (widget && widget.contains(e.target) && !e.target.closest('button, input')) onWidgetDragStart(e);
  }

  function onTouchEnd(e) {
    const onWidget = widget && widget.contains(e.target);
    if (settings.autoPause && !onWidget) {
      clearTimeout(userScrollTimer);
      userScrollTimer = setTimeout(() => {
        userScrolling = false;
        if (isScrolling && scrollInterval === null) scrollInterval = _rafScroll();
      }, AUTOPAUSE_RESUME_DELAY_MS);
    }
    if (isDragging) onWidgetDragEnd(e);
  }

  function onTouchMove(e) {
    if (isDragging) onWidgetDragMove(e);
  }

  // ─── Gesture Shortcuts ────────────────────────────────────────────────────────

  function handleGestureTap(e) {
    if (!settings.gestureShortcuts) return;
    if (widget && widget.contains(e.target)) return;
    if (Date.now() < gestureInhibitUntil) return; // ignore spurious touches after popup interaction

    const now = Date.now();
    if (now - lastTapTime > MULTI_TAP_WINDOW_MS) tapCount = 0;
    lastTapTime = now;
    tapCount++;

    clearTimeout(tapTimeout);
    tapTimeout = setTimeout(() => {
      const count = tapCount;
      tapCount = 0;
      if (count === 2) {
        // If user has quit (showWidget=false), do not toggle scroll via gesture.
        // This prevents accidental double-tap (e.g. iOS zoom) from resurrecting the widget.
        if (!settings.showWidget && !isScrolling) return;
        toggleScroll();
      } else if (count === 3) {
        settings.speed = 2;
        updateWidgetUI();
        notifyState();
      }
    }, MULTI_TAP_WINDOW_MS);
  }

  // ─── Floating Widget ──────────────────────────────────────────────────────────

  function isDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function createWidget() {
    if (widget) return;
    // Defensive guard: never create the widget if it's been disabled. This catches any
    // setTimeout/SPA self-heal path that might race past a showWidget=false update.
    if (!settings.showWidget) return;
    // widgetCollapsed keeps its current value (set by loadSiteSettings on init,
    // or preserved across SPA navigations since JS context is retained)

    // Remove any stale widget left by a previous script instance
    const stale = document.getElementById('__aws_widget__');
    if (stale) stale.remove();
    widgetPlayBtn = null;

    let savedPos = null;
    try {
      const raw = JSON.parse(localStorage.getItem(WIDGET_POS_KEY));
      if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) savedPos = raw;
    } catch (_) {}
    // Fallback: use globally cached position (loaded async from browser.storage.local)
    if (!savedPos && cachedWidgetPos) savedPos = cachedWidgetPos;

    // Clean up previously injected horizontal slider style (orientation switch)
    const prevHSliderStyle = document.getElementById('__aws_h_slider_style__');
    if (prevHSliderStyle) prevHSliderStyle.remove();

    widget    = document.createElement('div');
    widget.id = '__aws_widget__';

    const isHoriz = settings.widgetOrientation === 'horizontal';

    const posStyle = savedPos
      ? `left:${Math.max(0, Math.min(window.innerWidth  - 60, savedPos.x))}px; top:${Math.max(0, Math.min(window.innerHeight - 180, savedPos.y))}px;`
      : `right:16px; bottom:120px;`;

    if (isHoriz) {
      widget.style.cssText = `
        position:fixed; ${posStyle}
        z-index:2147483647;
        width:auto; padding:8px 10px;
        border-radius:14px;
        font-family:-apple-system,sans-serif; font-size:12px;
        box-shadow:0 4px 24px rgba(0,0,0,0.35);
        display:flex; flex-direction:row; align-items:center; gap:8px;
        touch-action:none; user-select:none; -webkit-user-select:none;
        cursor:grab;
      `;
    } else {
      widget.style.cssText = `
        position:fixed; ${posStyle}
        z-index:2147483647;
        width:52px; padding:10px 6px 10px;
        border-radius:14px;
        font-family:-apple-system,sans-serif; font-size:12px;
        box-shadow:0 4px 24px rgba(0,0,0,0.35);
        display:flex; flex-direction:column; align-items:center; gap:6px;
        touch-action:none; user-select:none; -webkit-user-select:none;
        cursor:grab;
      `;
    }
    applyWidgetTheme();

    // Collapse button
    const colBtn = document.createElement('button');
    colBtn.id = '__aws_col_btn__';
    colBtn.textContent = '–';
    colBtn.style.cssText = `
      width:22px; height:22px; border:none; border-radius:50%;
      background:transparent; font-size:14px; line-height:1;
      cursor:pointer; opacity:0.6; padding:0;
      color:${isDark() ? '#fff' : '#1C1C1E'};
      flex-shrink:0;
    `;
    colBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleWidgetCollapse();
    });

    // Speed label
    const speedLabel = document.createElement('span');
    speedLabel.id = '__aws_speed_label__';
    speedLabel.style.cssText = 'font-weight:700; font-size:12px; text-align:center; flex-shrink:0;';
    speedLabel.textContent = `${settings.speed}x`;

    // Slider (vertical or horizontal based on orientation)
    const sliderWrap = document.createElement('div');
    sliderWrap.id = '__aws_slider_wrap__';
    sliderWrap.style.cssText = 'display:flex; justify-content:center; align-items:center; flex:1;';

    const miniSlider = document.createElement('input');
    miniSlider.type = 'range';
    miniSlider.min = '1'; miniSlider.max = '20'; miniSlider.step = '1';
    miniSlider.value = String(settings.speed);
    if (isHoriz) {
      miniSlider.id = '__aws_mini_slider__';
      miniSlider.style.cssText = `
        -webkit-appearance: none;
        width: 110px;
        height: 4px;
        cursor: pointer;
        border-radius: 2px;
        outline: none;
        background: rgba(255,255,255,0.2);
      `;
      // Inject thumb style (pseudo-element can't be set via inline style)
      const hSliderStyle = document.createElement('style');
      hSliderStyle.id = '__aws_h_slider_style__';
      hSliderStyle.textContent = `
        #__aws_mini_slider__::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 20px; height: 20px;
          background: #30D158;
          border-radius: 50%;
          cursor: pointer;
        }
      `;
      document.head.appendChild(hSliderStyle);
    } else {
      miniSlider.style.cssText = `
        -webkit-appearance: slider-vertical;
        writing-mode: vertical-lr;
        direction: rtl;
        width: 28px;
        height: 110px;
        cursor: pointer;
        accent-color: #30D158;
      `;
    }
    miniSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      settings.speed = parseInt(miniSlider.value, 10);
      speedLabel.textContent = `${settings.speed}x`;
      autoSaveSettings();  // persist speed change made via widget slider
      notifyState();
    });
    // passive:true (allows native scroll through slider) + stopPropagation (blocks widget drag start)
    miniSlider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    sliderWrap.appendChild(miniSlider);

    // Play / Pause button
    const playBtn = document.createElement('button');
    playBtn.id = '__aws_play_btn__';
    playBtn.style.cssText = `
      width:36px; height:36px; border:none; border-radius:50%;
      font-size:18px; line-height:1; cursor:pointer; flex-shrink:0;
      display:flex; align-items:center; justify-content:center;
    `;
    widgetPlayBtn = playBtn;  // store direct reference
    _styleWidgetPlayBtn(playBtn);
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleScroll();
    });
    playBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    if (isHoriz) {
      // Horizontal: colBtn, speedLabel, slider, playBtn in a row
      widget.appendChild(colBtn);
      widget.appendChild(speedLabel);
      widget.appendChild(sliderWrap);
      widget.appendChild(playBtn);
    } else {
      // Vertical: colBtn at top, then speedLabel, slider, playBtn
      widget.appendChild(colBtn);
      widget.appendChild(speedLabel);
      widget.appendChild(sliderWrap);
      widget.appendChild(playBtn);
    }

    // Apply collapsed state using local refs (widget not yet in DOM, so getElementById unavailable)
    if (widgetCollapsed) {
      sliderWrap.style.display = 'none';
      speedLabel.style.display = 'none';
      colBtn.textContent       = '+';
      widget.style.width = isHoriz ? 'auto' : '44px';
    }

    document.body.appendChild(widget);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (darkModeListener) mq.removeEventListener('change', darkModeListener);
    darkModeListener = applyWidgetTheme;
    mq.addEventListener('change', darkModeListener);
    // Remove before re-adding to prevent duplicate resize listeners on SPA re-create
    window.removeEventListener('resize', _onResizeClamp);
    window.addEventListener('resize', _onResizeClamp);

    // Connect keepalive port (only on first creation, not SPA re-creates)
    // When extension is disabled, the port disconnects → widget is removed
    if (!_keepalivePort) _connectKeepalive();
  }

  // Wraps _clampWidgetToViewport in setTimeout so offsetWidth is ready after layout paint
  // (needed for horizontal mode where width:auto is resolved only after DOM paint)
  function _onResizeClamp() { setTimeout(_clampWidgetToViewport, 0); }

  function _clampWidgetToViewport() {
    if (!widget || widget.style.display === 'none') return;
    // Only clamp when left/top absolute positioning is active (set after a drag).
    // Default right/bottom positioning adapts to viewport automatically via CSS.
    const l = parseFloat(widget.style.left);
    const t = parseFloat(widget.style.top);
    if (isNaN(l) || isNaN(t)) return;
    const newLeft = Math.max(0, Math.min(window.innerWidth  - widget.offsetWidth,  l));
    const newTop  = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, t));
    widget.style.left = `${newLeft}px`;
    widget.style.top  = `${newTop}px`;
  }

  function applyWidgetTheme() {
    if (!widget) return;
    const dark = isDark();
    widget.style.background = dark ? 'rgba(44,44,46,0.95)' : 'rgba(255,255,255,0.95)';
    widget.style.color       = dark ? '#FFFFFF' : '#1C1C1E';
    widget.style.border      = dark ? '1px solid #3A3A3C' : '1px solid #D1D1D6';
    const colBtn = document.getElementById('__aws_col_btn__');
    if (colBtn) colBtn.style.color = dark ? '#fff' : '#1C1C1E';
  }

  function _applyWidgetCollapsedState() {
    if (!widget) return;
    const sliderWrap = document.getElementById('__aws_slider_wrap__');
    const speedLabel = document.getElementById('__aws_speed_label__');
    const colBtn     = document.getElementById('__aws_col_btn__');
    if (sliderWrap) sliderWrap.style.display = widgetCollapsed ? 'none' : 'flex';
    if (speedLabel) speedLabel.style.display = widgetCollapsed ? 'none' : 'block';
    if (colBtn)     colBtn.textContent       = widgetCollapsed ? '+' : '–';
    widget.style.width = settings.widgetOrientation === 'horizontal'
      ? 'auto'
      : (widgetCollapsed ? '44px' : '52px');
  }

  function _styleWidgetPlayBtn(btn) {
    const b = btn || widgetPlayBtn;
    if (!b) return;
    // \uFE0E = variation selector 15: forces text (monochrome) rendering
    b.textContent      = isScrolling ? '\u23F8\uFE0E' : '\u25B6\uFE0E';
    b.style.background = 'transparent';
    b.style.border     = `2.5px solid ${isScrolling ? '#FF9F0A' : '#30D158'}`;
    b.style.color      = isScrolling ? '#FF9F0A' : '#30D158';
  }

  function updateWidgetUI() {
    _styleWidgetPlayBtn(null);
    if (!widget) return;
    const sl = widget.querySelector('input[type=range]');
    const lb = widget.querySelector('#__aws_speed_label__');
    if (sl) sl.value = String(settings.speed);
    if (lb) lb.textContent = `${settings.speed}x`;
  }

  function toggleWidgetCollapse() {
    widgetCollapsed = !widgetCollapsed;
    // Persist: localStorage (same-site, sync) + browser.storage.local (cross-site, async)
    try { localStorage.setItem(WIDGET_COLLAPSED_KEY, widgetCollapsed ? '1' : '0'); } catch (_) {}
    try {
      const p = browser.storage?.local?.set({ [WIDGET_COLLAPSED_KEY]: widgetCollapsed });
      if (p) p.catch(() => {});
    } catch (_) {}
    _applyWidgetCollapsedState();
  }

  function showWidget() {
    if (!settings.showWidget) return;
    if (!widget) { createWidget(); }
    else { widget.style.display = 'flex'; }
  }

  function hideWidget() {
    if (widget) widget.style.display = 'none';
  }

  // ─── Widget Drag ──────────────────────────────────────────────────────────────

  function onWidgetDragStart(e) {
    e.preventDefault();
    isDragging = true; dragMoved = false;
    const t = e.touches[0];
    dragStartX = t.clientX; dragStartY = t.clientY;
    const r = widget.getBoundingClientRect();
    dragOrigLeft = r.left; dragOrigTop = r.top;
    widget.style.transition = 'none';
  }

  function onWidgetDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    dragMoved = true;
    const t = e.touches[0];
    const newLeft = Math.max(0, Math.min(window.innerWidth  - widget.offsetWidth,  dragOrigLeft + t.clientX - dragStartX));
    const newTop  = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, dragOrigTop  + t.clientY - dragStartY));
    widget.style.right  = 'auto';
    widget.style.bottom = 'auto';
    widget.style.left = `${newLeft}px`;
    widget.style.top  = `${newTop}px`;
  }

  function onWidgetDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    widget.style.transition = '';
    if (dragMoved) {
      const pos = { x: parseFloat(widget.style.left), y: parseFloat(widget.style.top) };
      try { localStorage.setItem(WIDGET_POS_KEY, JSON.stringify(pos)); } catch (_) {}
      // Also save globally so position persists when navigating to a different site
      cachedWidgetPos = pos;
      try {
        const p = browser.storage?.local?.set({ [WIDGET_POS_GLOBAL_KEY]: pos });
        if (p) p.catch(() => {});
      } catch (_) {}
    }
  }

  // ─── Message Handler (WebExtension API) ──────────────────────────────────────

  browser.runtime.onMessage.addListener((msg) => {
    const { name, message } = msg;

    switch (name) {
      case 'getState':
        notifyState();
        break;

      case 'toggle':
        toggleScroll();
        break;

      case 'start':
        startScroll();
        break;

      case 'stop':
        stopScroll();
        break;

      case 'quit':
        quitScroll();
        break;

      case 'updateSettings': {
        const prevDirection       = settings.direction;
        const prevShowWidget      = settings.showWidget;
        const prevWidgetOrient    = settings.widgetOrientation;
        for (const k of SETTINGS_KEYS) { if (k in message) settings[k] = message[k]; }
        if (!['vertical','horizontal'].includes(settings.widgetOrientation)) settings.widgetOrientation = 'vertical';
        // Any popup interaction: inhibit gesture shortcuts briefly to avoid
        // spurious double-tap from iOS touch-through on popup open/close
        gestureInhibitUntil = Date.now() + GESTURE_INHIBIT_MS;
        if (message.direction !== undefined && message.direction !== prevDirection) {
          // Direction changed — cancel autoPause so it takes effect immediately
          userScrolling = false;
          clearTimeout(userScrollTimer);
          // If the RAF loop was paused (autoPause), restart it now
          if (isScrolling && scrollInterval === null) scrollInterval = _rafScroll();
          // Pre-position scroll to the correct edge so loop doesn't look like wrong direction
          if (settings.loop && isScrolling && scrollTarget) {
            const st     = scrollTarget;
            const isRoot = st === document.documentElement;
            const stTop  = isRoot ? window.scrollY    : st.scrollTop;
            const stCliH = isRoot ? window.innerHeight : st.clientHeight;
            const stScrH = st.scrollHeight;
            if (settings.direction === 'up' && stTop <= SCROLL_LOOP_EDGE_TOLERANCE) {
              isRoot ? window.scrollTo(0, stScrH) : (st.scrollTop = stScrH);
            } else if (settings.direction === 'down' && stTop + stCliH >= stScrH - SCROLL_LOOP_EDGE_TOLERANCE) {
              isRoot ? window.scrollTo(0, 0) : (st.scrollTop = 0);
            }
          }
        }
        // Restart timer if timerMins changed during active scroll
        if (message.timerMins !== undefined && isScrolling) {
          clearTimeout(timerTimeout);
          timerTimeout = settings.timerMins > 0
            ? setTimeout(onTimerExpired, settings.timerMins * 60 * 1000)
            : null;
        }
        // Handle widget visibility change via updateSettings (fallback for lost showWidget/hideWidget msgs)
        if (message.showWidget !== undefined && settings.showWidget !== prevShowWidget) {
          if (settings.showWidget) showWidget();
          else hideWidget();
        }
        // Handle orientation change: recreate widget with new layout, then clamp position
        if (message.widgetOrientation !== undefined && settings.widgetOrientation !== prevWidgetOrient) {
          if (widget) { widget.remove(); widget = null; widgetPlayBtn = null; }
          if (settings.showWidget) createWidget();
          setTimeout(_clampWidgetToViewport, 0);  // clamp after layout paint (offsetWidth ready)
        }
        autoSaveSettings();
        updateWidgetUI();
        notifyState();
        break;
      }

      case 'showWidget':
        settings.showWidget = true;
        showWidget();
        break;

      case 'hideWidget':
        settings.showWidget = false;
        hideWidget();
        break;
    }
  });

  // ─── SPA Navigation Detection ─────────────────────────────────────────────────

  function onNavigate() {
    // Capture both scroll state AND the "ended at page bottom" intent before clearing.
    // seriesResumeIntent is true when doScroll() auto-stopped at the end of the page
    // while seriesMode was on — isScrolling is already false in that case, so we must
    // check the flag separately.
    const wasScrolling    = isScrolling;
    const hadResumeIntent = seriesResumeIntent;
    seriesResumeIntent    = false;
    if (isScrolling) stopScroll();
    scrollTarget = null;

    // Null the JS ref synchronously (before the 300ms timer fires) so that if another
    // code path calls createWidget() during the delay it starts from a clean state.
    if (!document.getElementById('__aws_widget__')) { widget = null; widgetPlayBtn = null; }

    // Accumulate resume intent: a rapid second navigation must not erase the first
    // navigation's intent (its stopScroll already set isScrolling=false).
    if ((wasScrolling || hadResumeIntent) && settings.seriesMode) pendingResume = true;

    // Coalesce rapid navigations into a single re-inject/resume timer.
    clearTimeout(navigateTimer);
    navigateTimer = setTimeout(() => {
      navigateTimer = null;
      const doResume = pendingResume;
      pendingResume  = false;
      if (settings.showWidget && !document.getElementById('__aws_widget__')) {
        widget = null;
        createWidget();
      }
      // Re-check seriesMode inside the timer — user may have toggled it off during the delay.
      if (doResume && settings.seriesMode) startScroll();
    }, SPA_REINJECT_DELAY_MS);
  }

  // Intercept history.pushState / replaceState (SPA navigation)
  const _origPushState    = history.pushState.bind(history);
  const _origReplaceState = history.replaceState.bind(history);
  history.pushState = function(...args) {
    _origPushState(...args);
    onNavigate();
  };
  history.replaceState = function(...args) {
    _origReplaceState(...args);
    onNavigate();
  };
  window.addEventListener('popstate', onNavigate);

  // bfcache (Back/Forward Cache): when the page is stored in bfcache the JS heap
  // is frozen — including any running RAF loop. On restoration, the old IIFE's RAF
  // resumes alongside the newly injected IIFE's loop, doubling the effective speed
  // and making scroll impossible to stop. Calling stopScroll() on pagehide cancels
  // the RAF before the page enters bfcache, so there is no stale loop on restore.
  //
  // Series mode: save a timestamped intent to browser.storage.local so that the
  // next page's content.js knows to auto-start scroll. Intent is one-shot (cleared
  // on read) and expires after SERIES_INTENT_TTL_MS to prevent stale restarts.
  window.addEventListener('pagehide', () => {
    if ((isScrolling || seriesResumeIntent) && settings.seriesMode) {
      try {
        const p = browser.storage?.local?.set({ [SERIES_INTENT_KEY]: { ts: Date.now() } });
        if (p) p.catch(() => {});
      } catch (_) {}
    }
    seriesResumeIntent = false;
    stopScroll();
  });

  // pageshow with persisted=true means the page was restored from bfcache.
  // Defensively force-stop any scroll state in case the previous IIFE somehow survived,
  // and clear stuck-detection state to prevent immediate auto-stop on resume.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      // bfcache restore may revive a stale resume intent from the frozen heap —
      // clear it so the back/forward target page doesn't auto-resume unexpectedly.
      seriesResumeIntent = false;
      pendingResume      = false;
      stopScroll();
      lastScrollPos = -1;
      stuckFrames   = 0;
    }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────────

  loadSiteSettings();
  // Widget init: try after the async storage callback has had a chance to resolve.
  // The async callback in loadSiteSettings will create the widget if cross-domain
  // settings arrive in time; this fallback handles cases where browser.storage.local
  // is unavailable or slow. createWidget() has a defensive `!settings.showWidget` guard
  // so a quit-before-fallback race can't accidentally re-create the widget.
  setTimeout(() => { if (!widget && settings.showWidget) showWidget(); }, SPA_REINJECT_DELAY_MS);
  notifyState();
})();
