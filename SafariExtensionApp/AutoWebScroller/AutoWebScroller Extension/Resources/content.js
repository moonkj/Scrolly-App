// content.js – AutoWebScroller v1.1  (Safari Web Extension API)

(() => {
  // ─── State ───────────────────────────────────────────────────────────────────
  let scrollInterval = null;
  let isScrolling    = false;

  let settings = {
    speed:            3,
    direction:        'down',
    loop:             false,
    autoPause:        true,
    timerMins:        0,
    gestureShortcuts: true,
    showWidget:       true
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

  // Content-aware
  let originalSpeed = null;

  // Scroll engine
  let scrollTarget      = null;  // cached scroll target element
  let lastRafTime       = null;  // for delta-time calculation
  let contentAwareTimer = 0;     // throttle: checkContentAware every 60 frames
  let spaCheckTimer     = 0;     // throttle: SPA widget re-inject check every 120 frames

  // Widget
  let widget              = null;
  let widgetPlayBtn       = null;  // direct reference to avoid getElementById miss
  let widgetCollapsed     = false;
  let darkModeListener    = null;  // stored ref to prevent duplicate matchMedia listeners
  let isDragging      = false;
  let dragMoved       = false;
  let dragStartX      = 0, dragStartY  = 0;
  let dragOrigLeft    = 0, dragOrigTop = 0;

  // Wake Lock
  let wakeLock = null;

  // Storage keys
  const SETTINGS_KEY   = 'aws_settings';
  const WIDGET_POS_KEY = `aws_widget_pos_${location.hostname}`;

  // ─── Wake Lock ────────────────────────────────────────────────────────────────

  async function acquireWakeLock() {
    try {
      if (!('wakeLock' in navigator)) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) {}
  }

  function releaseWakeLock() {
    try { wakeLock?.release(); } catch (_) {}
    wakeLock = null;
  }

  // ─── Settings persistence (global, auto-save) ─────────────────────────────────

  function loadSiteSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(settings, JSON.parse(raw));
    } catch (_) {}
  }

  function autoSaveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {}
  }

  // ─── Scroll Target Detection ──────────────────────────────────────────────────

  function getScrollTarget() {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    let el = document.elementFromPoint(cx, cy);
    while (el && el !== document.documentElement) {
      const style    = getComputedStyle(el);
      const overflow = style.overflow + style.overflowY;
      if ((overflow.includes('auto') || overflow.includes('scroll')) &&
          el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return document.documentElement;
  }

  // ─── Content-Aware Speed ──────────────────────────────────────────────────────

  const AD_SELECTORS = [
    '.ad', '.advertisement', '.ads', '#ad',
    '[class*="ad-"]', '[id*="advertisement"]',
    '.sponsor', '.promoted', '.banner',
    'iframe[src*="ads"]', 'iframe[src*="doubleclick"]'
  ].join(',');

  function checkContentAware() {
    if (!settings.contentAware) return;
    const viewH = window.innerHeight;

    let adFound = false;
    try {
      for (const el of document.querySelectorAll(AD_SELECTORS)) {
        const r = el.getBoundingClientRect();
        if (r.top < viewH && r.bottom > 0) { adFound = true; break; }
      }
    } catch (_) {}

    let imgCount = 0;
    if (!adFound) {
      try {
        for (const img of document.querySelectorAll('img')) {
          if (img.naturalWidth <= 200) continue;
          const r = img.getBoundingClientRect();
          if (r.top < viewH && r.bottom > 0 && ++imgCount >= 3) break;
        }
      } catch (_) {}
    }

    const imageHeavy = imgCount >= 3;

    if (adFound && originalSpeed === null) {
      originalSpeed  = settings.speed;
      settings.speed = Math.min(20, settings.speed * 3);
    } else if (imageHeavy && originalSpeed === null) {
      originalSpeed  = settings.speed;
      settings.speed = Math.max(1, Math.round(settings.speed * 0.5));
    } else if (!adFound && !imageHeavy && originalSpeed !== null) {
      settings.speed = originalSpeed;
      originalSpeed  = null;
    }
  }

  // ─── Scroll Loop ──────────────────────────────────────────────────────────────

  // Quadratic speed curve (pixels per second):
  //   speed 1 → ~9 px/s   speed 5 → ~225 px/s
  //   speed 10 → ~900 px/s  speed 20 → ~3600 px/s
  function speedToPps(s) {
    return s * s * 9;
  }

  function doScroll(timestamp) {
    if (!isScrolling) return;

    // SPA self-heal: throttled to every 120 frames (~2s) to avoid per-frame getElementById
    if (settings.showWidget && ++spaCheckTimer >= 120) {
      spaCheckTimer = 0;
      if (!document.getElementById('__aws_widget__')) {
        widget = null; widgetPlayBtn = null; // reset stale JS refs before recreating
        createWidget();
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
    const dt = Math.min(timestamp - lastRafTime, 50); // cap 50ms (tab-switch protection)
    lastRafTime = timestamp;

    const pps   = speedToPps(settings.speed);
    const delta = (settings.direction === 'down' ? pps : -pps) * dt / 1000;
    // scrollBy: relative write, no implicit layout read (unlike scrollTop +=)
    scrollTarget.scrollBy(0, delta);

    if (settings.loop) {
      const st = scrollTarget;
      const isRoot     = st === document.documentElement;
      const scrollTop  = isRoot ? window.scrollY    : st.scrollTop;
      const clientH    = isRoot ? window.innerHeight : st.clientHeight;
      const scrollH    = st.scrollHeight;
      if (settings.direction === 'down' && scrollTop + clientH >= scrollH - 2) {
        isRoot ? window.scrollTo(0, 0) : (st.scrollTop = 0);
      } else if (settings.direction === 'up' && scrollTop <= 2) {
        isRoot ? window.scrollTo(0, scrollH) : (st.scrollTop = scrollH);
      }
    }

    scrollInterval = requestAnimationFrame(doScroll);
  }

  // ─── Start / Stop / Toggle ────────────────────────────────────────────────────

  // Called when the scroll timer fires naturally (not user-initiated stop).
  // Resets timerMins to 0 so the popup/storage reflects "no timer" state.
  function onTimerExpired() {
    settings.timerMins = 0;
    autoSaveSettings();
    stopScroll();
  }

  function startScroll() {
    if (isScrolling) return;
    isScrolling       = true;
    userScrolling     = false; // clear any stale autoPause state
    lastRafTime       = null;
    spaCheckTimer     = 0;
    scrollTarget      = getScrollTarget();
    // Hint to browser compositor to pre-render scroll tiles
    try { scrollTarget.style.setProperty('will-change', 'scroll-position'); } catch (_) {}
    scrollInterval = requestAnimationFrame(doScroll);
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
    cancelAnimationFrame(scrollInterval); scrollInterval = null;
    clearTimeout(timerTimeout);           timerTimeout   = null;
    clearTimeout(userScrollTimer);        userScrollTimer = null;
    userScrolling = false;
    if (originalSpeed !== null) { settings.speed = originalSpeed; originalSpeed = null; }
    try { if (scrollTarget) scrollTarget.style.setProperty('will-change', 'auto'); } catch (_) {}
    releaseWakeLock();
    updateWidgetUI();
    notifyState();
  }

  function toggleScroll() { isScrolling ? stopScroll() : startScroll(); }

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
      if (isScrolling && scrollInterval === null) scrollInterval = requestAnimationFrame(doScroll);
    }, 3000);
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
        if (isScrolling && scrollInterval === null) scrollInterval = requestAnimationFrame(doScroll);
      }, 3000);
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
    if (now - lastTapTime > 500) tapCount = 0;
    lastTapTime = now;
    tapCount++;

    clearTimeout(tapTimeout);
    tapTimeout = setTimeout(() => {
      const count = tapCount;
      tapCount = 0;
      if (count === 2) {
        toggleScroll();
      } else if (count === 3) {
        settings.speed = 2;
        originalSpeed  = null;
        updateWidgetUI();
        notifyState();
      }
    }, 500);
  }

  // ─── Floating Widget ──────────────────────────────────────────────────────────

  function isDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function createWidget() {
    if (widget) return;

    // Remove any stale widget left by a previous script instance
    const stale = document.getElementById('__aws_widget__');
    if (stale) stale.remove();
    widgetPlayBtn = null;

    let savedPos = null;
    try {
      const raw = JSON.parse(localStorage.getItem(WIDGET_POS_KEY));
      if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) savedPos = raw;
    } catch (_) {}

    widget    = document.createElement('div');
    widget.id = '__aws_widget__';

    const posStyle = savedPos
      ? `left:${Math.max(0, Math.min(window.innerWidth  - 60, savedPos.x))}px; top:${Math.max(0, Math.min(window.innerHeight - 180, savedPos.y))}px;`
      : `right:16px; bottom:120px;`;

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

    // Vertical slider
    const sliderWrap = document.createElement('div');
    sliderWrap.id = '__aws_slider_wrap__';
    sliderWrap.style.cssText = 'display:flex; justify-content:center; align-items:center; flex:1;';

    const miniSlider = document.createElement('input');
    miniSlider.type = 'range';
    miniSlider.min = '1'; miniSlider.max = '20'; miniSlider.step = '1';
    miniSlider.value = String(settings.speed);
    miniSlider.style.cssText = `
      -webkit-appearance: slider-vertical;
      writing-mode: vertical-lr;
      direction: rtl;
      width: 28px;
      height: 110px;
      cursor: pointer;
      accent-color: #30D158;
    `;
    miniSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      settings.speed = parseInt(miniSlider.value, 10);
      speedLabel.textContent = `${settings.speed}x`;
      notifyState();
    });
    miniSlider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    sliderWrap.appendChild(miniSlider);

    // Play / Pause button (bottom)
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

    widget.appendChild(colBtn);
    widget.appendChild(speedLabel);
    widget.appendChild(sliderWrap);
    widget.appendChild(playBtn);

    document.body.appendChild(widget);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (darkModeListener) mq.removeEventListener('change', darkModeListener);
    darkModeListener = applyWidgetTheme;
    mq.addEventListener('change', darkModeListener);
    window.addEventListener('resize', _clampWidgetToViewport);
  }

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
    const sliderWrap = document.getElementById('__aws_slider_wrap__');
    const speedLabel = document.getElementById('__aws_speed_label__');
    const colBtn     = document.getElementById('__aws_col_btn__');
    if (sliderWrap) sliderWrap.style.display = widgetCollapsed ? 'none' : 'flex';
    if (speedLabel) speedLabel.style.display = widgetCollapsed ? 'none' : 'block';
    if (colBtn)     colBtn.textContent       = widgetCollapsed ? '+' : '–';
    if (widget)     widget.style.width       = widgetCollapsed ? '44px' : '52px';
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
      try {
        localStorage.setItem(WIDGET_POS_KEY, JSON.stringify({
          x: parseFloat(widget.style.left),
          y: parseFloat(widget.style.top)
        }));
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

      case 'updateSettings': {
        const prevDirection = settings.direction;
        Object.assign(settings, message);
        // Any popup interaction: inhibit gesture shortcuts for 800ms to avoid
        // spurious double-tap from iOS touch-through on popup open/close
        gestureInhibitUntil = Date.now() + 800;
        if (message.direction !== undefined && message.direction !== prevDirection) {
          // Direction changed — cancel autoPause so it takes effect immediately
          userScrolling = false;
          clearTimeout(userScrollTimer);
          // If the RAF loop was paused (autoPause), restart it now
          if (isScrolling && scrollInterval === null) scrollInterval = requestAnimationFrame(doScroll);
          // Pre-position scroll to the correct edge so loop doesn't look like wrong direction
          if (settings.loop && isScrolling && scrollTarget) {
            const st     = scrollTarget;
            const isRoot = st === document.documentElement;
            const stTop  = isRoot ? window.scrollY    : st.scrollTop;
            const stCliH = isRoot ? window.innerHeight : st.clientHeight;
            const stScrH = st.scrollHeight;
            if (settings.direction === 'up' && stTop <= 2) {
              isRoot ? window.scrollTo(0, stScrH) : (st.scrollTop = stScrH);
            } else if (settings.direction === 'down' && stTop + stCliH >= stScrH - 2) {
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
        autoSaveSettings();
        updateWidgetUI();
        notifyState();
        break;
      }

      case 'showWidget':
        showWidget();
        break;

      case 'hideWidget':
        hideWidget();
        break;
    }
  });

  // ─── SPA Navigation Detection ─────────────────────────────────────────────────

  function onNavigate() {
    // Stop scroll — scroll target likely changed after navigation
    if (isScrolling) stopScroll();
    scrollTarget = null;

    // If SPA removed our widget from the DOM, null the reference so createWidget() can re-run
    if (!document.getElementById('__aws_widget__')) { widget = null; widgetPlayBtn = null; }

    // Re-inject widget after SPA finishes rendering (~300ms delay)
    if (settings.showWidget) {
      setTimeout(() => {
        if (!document.getElementById('__aws_widget__')) {
          widget = null;
          createWidget();
        }
      }, 300);
    }
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

  // ─── Init ─────────────────────────────────────────────────────────────────────

  loadSiteSettings();
  if (settings.showWidget) showWidget();
  notifyState();
})();
