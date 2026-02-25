// tests/content.test.js — Tests for content.js (IIFE, loaded via require for coverage)

const path = require('path');
const CONTENT_PATH = path.resolve(__dirname, '../ios/SafariExtension/Resources/content.js');

// ─── Window + document listener cleanup ──────────────────────────────────────
// content.js adds event listeners to `window` and `document` on every require().
// Without cleanup they accumulate across tests, causing stale closures to fire.

const _origWAEL = window.addEventListener.bind(window);
const _origDAEL = document.addEventListener.bind(document);
let _addELSpy   = null;
let _addDocELSpy = null;
let _addedListeners = [];     // window listeners
let _addedDocListeners = [];  // document listeners

beforeEach(() => {
  _addedListeners = [];
  _addedDocListeners = [];

  _addELSpy = jest.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => {
    _addedListeners.push({ type, fn });
    _origWAEL(type, fn, opts);
  });

  _addDocELSpy = jest.spyOn(document, 'addEventListener').mockImplementation((type, fn, opts) => {
    _addedDocListeners.push({ type, fn });
    _origDAEL(type, fn, opts);
  });
});

afterEach(() => {
  _addELSpy?.mockRestore();
  _addELSpy = null;
  _addedListeners.forEach(({ type, fn }) => window.removeEventListener(type, fn));
  _addedListeners = [];

  _addDocELSpy?.mockRestore();
  _addDocELSpy = null;
  _addedDocListeners.forEach(({ type, fn }) => document.removeEventListener(type, fn));
  _addedDocListeners = [];
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Controlled RAF queue: deferred execution so the scroll loop doesn't cause
// infinite synchronous recursion.
function createRafQueue() {
  const queue = [];
  global.requestAnimationFrame = jest.fn(cb => {
    queue.push(cb);
    return queue.length;
  });
  global.cancelAnimationFrame = jest.fn(id => {
    if (id > 0 && id <= queue.length) queue[id - 1] = null;
  });

  function runFrame(timestamp) {
    const batch = queue.splice(0);
    batch.forEach(cb => cb && cb(timestamp));
  }
  return { queue, runFrame };
}

// Load content.js into the current jsdom context.
// Returns the message listener registered with browser.runtime.onMessage.addListener.
// jest.resetModules() ensures each call gets a fresh module state (fresh IIFE closure).
function loadContent() {
  // Stub scrollBy (jsdom doesn't implement it)
  document.documentElement.scrollBy = jest.fn();
  document.documentElement.scrollHeight = 5000;
  document.documentElement.scrollTop    = 0;
  document.documentElement.clientHeight = 900;

  // elementFromPoint → return documentElement (simplest: no inner scroll container)
  document.elementFromPoint = jest.fn(() => document.documentElement);

  jest.resetModules();
  require(CONTENT_PATH);

  const calls = browser.runtime.onMessage.addListener.mock.calls;
  return calls[calls.length - 1][0];
}

// Send a message to the content script listener
function sendMsg(listener, name, message = {}) {
  listener({ name, message });
}

// Create a touch-start event with a fake touches array.
// Must dispatch on a real DOM Node (not window) because onTouchStart calls
// widget.contains(e.target) which requires e.target to be a Node.
// Dispatching on document.body with bubbles:true reaches the window listener,
// and e.target = document.body which is a valid Node.
function fireTouchStart(target = document.body) {
  const evt = new Event('touchstart', { bubbles: true, cancelable: true });
  evt.touches = [{ identifier: 1, target, clientX: 0, clientY: 0 }];
  target.dispatchEvent(evt);
}

function fireTouchEnd(target = document.body) {
  const evt = new Event('touchend', { bubbles: true, cancelable: true });
  evt.changedTouches = [];
  target.dispatchEvent(evt);
}

// ─── speedToPps — quadratic speed curve ──────────────────────────────────────
// speedToPps(s) = s * s * 9  (internal function, verified via scrollBy delta)
// Approach: 2 controlled RAF frames (frame 1 at ts=0 → dt=0, frame 2 at ts=1000 → dt=1000ms)
// => total scrollBy delta ≈ speed²×9

describe('speedToPps — quadratic speed curve', () => {
  let runFrame;

  beforeEach(() => {
    ({ runFrame } = createRafQueue());
  });

  // doScroll caps dt at 50ms. Run frame ts=0 (establishes lastRafTime, dt=0)
  // then 20 frames at 50ms intervals → total elapsed = 1000ms.
  // Per-frame delta = speed²*9 * (50/1000). Total = speed²*9.
  function measureDelta(listener, speed, direction = 'down') {
    sendMsg(listener, 'updateSettings', { speed, direction });
    document.documentElement.scrollBy = jest.fn();
    sendMsg(listener, 'start');
    runFrame(0);                          // frame 1: dt=0, no scroll
    for (let ts = 50; ts <= 1000; ts += 50) runFrame(ts); // 20 frames × 50ms
    return document.documentElement.scrollBy.mock.calls
      .reduce((sum, args) => sum + args[1], 0);
  }

  test('speed=1 → ~9 px/s', () => {
    const listener = loadContent();
    expect(measureDelta(listener, 1)).toBeCloseTo(9, 0);
  });

  test('speed=5 → ~225 px/s', () => {
    const listener = loadContent();
    expect(measureDelta(listener, 5)).toBeCloseTo(225, 0);
  });

  test('speed=10 → ~900 px/s', () => {
    const listener = loadContent();
    expect(measureDelta(listener, 10)).toBeCloseTo(900, 0);
  });

  test('direction=up → negative delta', () => {
    const listener = loadContent();
    expect(measureDelta(listener, 5, 'up')).toBeLessThan(0);
  });
});

// ─── Settings persistence ─────────────────────────────────────────────────────

describe('settings persistence', () => {
  test('loads saved settings from localStorage on init', () => {
    localStorage.setItem('aws_settings', JSON.stringify({ speed: 7, direction: 'up' }));
    const listener = loadContent();
    browser.runtime.sendMessage.mockClear();
    sendMsg(listener, 'getState');
    const stateMsg = browser.runtime.sendMessage.mock.calls
      .map(c => c[0]).find(m => m.name === 'stateChanged');
    expect(stateMsg.settings.speed).toBe(7);
    expect(stateMsg.settings.direction).toBe('up');
  });

  test('auto-saves settings to localStorage on updateSettings', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { speed: 12 });
    expect(JSON.parse(localStorage.getItem('aws_settings')).speed).toBe(12);
  });

  test('malformed localStorage JSON does not crash', () => {
    localStorage.setItem('aws_settings', 'NOT_JSON');
    expect(() => loadContent()).not.toThrow();
  });
});

// ─── Start / Stop / Toggle ────────────────────────────────────────────────────

describe('startScroll / stopScroll / toggleScroll', () => {
  let listener;
  beforeEach(() => { listener = loadContent(); });

  function findStateMsg(isScrolling) {
    return browser.runtime.sendMessage.mock.calls
      .map(c => c[0])
      .find(m => m && m.name === 'stateChanged' && m.isScrolling === isScrolling);
  }

  test('start → isScrolling=true, notifyState fired', () => {
    sendMsg(listener, 'start');
    expect(findStateMsg(true)).toBeTruthy();
  });

  test('stop after start → isScrolling=false', () => {
    sendMsg(listener, 'start');
    browser.runtime.sendMessage.mockClear();
    sendMsg(listener, 'stop');
    expect(findStateMsg(false)).toBeTruthy();
  });

  test('toggle from stopped → running', () => {
    sendMsg(listener, 'toggle');
    expect(findStateMsg(true)).toBeTruthy();
  });

  test('toggle twice → back to stopped', () => {
    sendMsg(listener, 'toggle');
    browser.runtime.sendMessage.mockClear();
    sendMsg(listener, 'toggle');
    expect(findStateMsg(false)).toBeTruthy();
  });

  test('double-start is idempotent (no duplicate RAF)', () => {
    sendMsg(listener, 'start');
    const rafBefore = requestAnimationFrame.mock.calls.length;
    sendMsg(listener, 'start');
    expect(requestAnimationFrame.mock.calls.length).toBe(rafBefore);
  });
});

// ─── updateSettings message ───────────────────────────────────────────────────

describe('updateSettings message', () => {
  let listener;
  beforeEach(() => { listener = loadContent(); });

  test('updates speed and saves to localStorage', () => {
    sendMsg(listener, 'updateSettings', { speed: 8 });
    expect(JSON.parse(localStorage.getItem('aws_settings')).speed).toBe(8);
  });

  test('sends stateChanged with updated speed', () => {
    sendMsg(listener, 'updateSettings', { speed: 6 });
    const msg = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged');
    expect(msg.settings.speed).toBe(6);
  });

  test('partial update preserves other settings (speed stays at default 3)', () => {
    sendMsg(listener, 'updateSettings', { direction: 'up' });
    const saved = JSON.parse(localStorage.getItem('aws_settings'));
    expect(saved.speed).toBe(3);
    expect(saved.direction).toBe('up');
  });
});

// ─── getState message ─────────────────────────────────────────────────────────

describe('getState message', () => {
  test('sends stateChanged with current state', () => {
    const listener = loadContent();
    browser.runtime.sendMessage.mockClear();
    sendMsg(listener, 'getState');
    expect(browser.runtime.sendMessage.mock.calls[0][0]).toMatchObject({
      name: 'stateChanged',
      isScrolling: false,
    });
  });
});

// ─── Floating Widget ──────────────────────────────────────────────────────────

describe('floating widget', () => {
  test('widget created on init when showWidget=true (default)', () => {
    loadContent();
    expect(document.getElementById('__aws_widget__')).not.toBeNull();
  });

  test('widget NOT created when showWidget=false in saved settings', () => {
    localStorage.setItem('aws_settings', JSON.stringify({ showWidget: false }));
    loadContent();
    expect(document.getElementById('__aws_widget__')).toBeNull();
  });

  test('hideWidget → display:none', () => {
    const listener = loadContent();
    sendMsg(listener, 'hideWidget');
    expect(document.getElementById('__aws_widget__').style.display).toBe('none');
  });

  test('showWidget after hideWidget → display no longer none', () => {
    const listener = loadContent();
    sendMsg(listener, 'hideWidget');
    sendMsg(listener, 'showWidget');
    expect(document.getElementById('__aws_widget__').style.display).not.toBe('none');
  });

  test('stale widget element removed before re-creation', () => {
    const stale = document.createElement('div');
    stale.id = '__aws_widget__';
    document.body.appendChild(stale);
    loadContent(); // should remove stale and create fresh
    expect(document.querySelectorAll('#__aws_widget__').length).toBe(1);
  });

  test('play button shows play icon when stopped', () => {
    loadContent();
    const btn = document.getElementById('__aws_play_btn__');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('\u25B6');
  });

  test('play button shows pause icon and changes color when scrolling', () => {
    const listener = loadContent();
    const btn = document.getElementById('__aws_play_btn__');
    const stoppedColor = btn.style.color;

    sendMsg(listener, 'start');

    expect(btn.textContent).toContain('\u23F8');
    expect(btn.style.color).not.toBe(stoppedColor);
  });
});

// ─── Gesture shortcuts ────────────────────────────────────────────────────────

describe('gesture shortcuts', () => {
  let listener;

  beforeEach(() => {
    jest.useFakeTimers();
    listener = loadContent();
    sendMsg(listener, 'updateSettings', { gestureShortcuts: true });
    jest.advanceTimersByTime(800); // advance past gestureInhibitUntil window
    browser.runtime.sendMessage.mockClear();
  });

  afterEach(() => { jest.useRealTimers(); });

  test('double-tap toggles scroll (starts scrolling)', () => {
    fireTouchStart();
    fireTouchStart();
    jest.advanceTimersByTime(500);
    const started = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged' && m.isScrolling === true);
    expect(started).toBeTruthy();
  });

  test('triple-tap resets speed to 2', () => {
    sendMsg(listener, 'updateSettings', { speed: 10 });
    jest.advanceTimersByTime(800); // advance past new gestureInhibitUntil window
    browser.runtime.sendMessage.mockClear();
    fireTouchStart();
    fireTouchStart();
    fireTouchStart();
    jest.advanceTimersByTime(500);
    const msg = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged');
    expect(msg.settings.speed).toBe(2);
  });

  test('gestures disabled when gestureShortcuts=false → no toggle', () => {
    sendMsg(listener, 'updateSettings', { gestureShortcuts: false });
    jest.advanceTimersByTime(800); // advance past inhibit window
    browser.runtime.sendMessage.mockClear();
    fireTouchStart();
    fireTouchStart();
    jest.advanceTimersByTime(500);
    const started = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged' && m.isScrolling === true);
    expect(started).toBeFalsy();
  });

  test('gesture inhibited within 800ms after updateSettings', () => {
    sendMsg(listener, 'updateSettings', { speed: 5 }); // gestureInhibitUntil 재설정
    browser.runtime.sendMessage.mockClear();
    fireTouchStart(); fireTouchStart();
    jest.advanceTimersByTime(500);
    const started = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged' && m.isScrolling === true);
    expect(started).toBeFalsy();
  });

  test('gesture works after 800ms inhibit window expires', () => {
    sendMsg(listener, 'updateSettings', { speed: 5 });
    jest.advanceTimersByTime(800); // inhibit 창 경과
    browser.runtime.sendMessage.mockClear();
    fireTouchStart(); fireTouchStart();
    jest.advanceTimersByTime(500);
    const started = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged' && m.isScrolling === true);
    expect(started).toBeTruthy();
  });
});

// ─── Auto-pause ───────────────────────────────────────────────────────────────

describe('auto-pause', () => {
  let runFrame;

  beforeEach(() => {
    jest.useFakeTimers();
    ({ runFrame } = createRafQueue());
  });

  afterEach(() => { jest.useRealTimers(); });

  test('touchstart on non-widget blocks scrollBy in next frame', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { autoPause: true });
    sendMsg(listener, 'start');

    runFrame(0);   // frame 1: lastRafTime=0, dt=0 → no scroll, schedule frame 2

    fireTouchStart(); // dispatches on document.body → sets userScrolling=true

    document.documentElement.scrollBy = jest.fn();
    runFrame(1000); // frame 2: userScrolling=true → skip scrollBy
    expect(document.documentElement.scrollBy).not.toHaveBeenCalled();
  });

  test('touchend → scroll resumes after 3s', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { autoPause: true });
    sendMsg(listener, 'start');

    runFrame(0); // establish lastRafTime

    fireTouchStart();
    fireTouchEnd(); // sets 3s resume timer

    document.documentElement.scrollBy = jest.fn();
    runFrame(1000); // still paused
    expect(document.documentElement.scrollBy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(3000); // userScrolling = false

    document.documentElement.scrollBy.mockClear();
    runFrame(1500); // dt = min(1500-0, 50) = 50ms → scrollBy called
    expect(document.documentElement.scrollBy).toHaveBeenCalled();
  });

  test('autoPause=false → touchstart does NOT block scrollBy', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { autoPause: false });
    sendMsg(listener, 'start');
    runFrame(0);
    fireTouchStart();
    document.documentElement.scrollBy = jest.fn();
    runFrame(1000);
    expect(document.documentElement.scrollBy).toHaveBeenCalled();
  });
});

// ─── Loop boundary ────────────────────────────────────────────────────────────
// Uses a custom scroll mock element to avoid jsdom's non-settable scrollHeight.

describe('loop boundary reset', () => {
  let runFrame;
  let scrollMock;
  let origGetComputedStyle;

  beforeEach(() => {
    ({ runFrame } = createRafQueue());

    // Plain mock object acts as the scroll target.
    // getScrollTarget() finds it because getComputedStyle returns overflow:scroll
    // and scrollHeight > clientHeight.
    scrollMock = {
      scrollTop:     4100,
      scrollHeight:  5000,
      clientHeight:   900,
      scrollBy:      jest.fn(),
      parentElement: document.documentElement,
      style:         { setProperty: jest.fn() },
    };

    origGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = jest.fn(el =>
      el === scrollMock
        ? { overflow: 'scroll', overflowY: 'scroll' }
        : origGetComputedStyle(el)
    );
    // NOTE: loadContent() resets elementFromPoint → set it again AFTER loadContent()
  });

  afterEach(() => {
    window.getComputedStyle = origGetComputedStyle;
  });

  test('loop=true, direction=down: resets scrollTop to 0 when near bottom', () => {
    const listener = loadContent();
    // Override elementFromPoint AFTER loadContent() so startScroll picks up scrollMock
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { loop: true, direction: 'down', speed: 3 });
    sendMsg(listener, 'start'); // getScrollTarget() → scrollMock
    runFrame(0); // dt=0, loop check: 4100+900 >= 4998 → scrollTop=0
    expect(scrollMock.scrollTop).toBe(0);
  });

  test('loop=true, direction=up: resets scrollTop to scrollHeight when at top', () => {
    scrollMock.scrollTop = 1;
    const listener = loadContent();
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { loop: true, direction: 'up', speed: 3 });
    sendMsg(listener, 'start');
    runFrame(0); // loop check: 1 <= 2 → scrollTop = scrollHeight = 5000
    expect(scrollMock.scrollTop).toBe(scrollMock.scrollHeight);
  });

  test('loop=false: scrollTop NOT reset at boundary', () => {
    const listener = loadContent();
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { loop: false, direction: 'down', speed: 3 });
    sendMsg(listener, 'start');
    runFrame(0);
    expect(scrollMock.scrollTop).toBe(4100); // unchanged
  });
});

// ─── SPA Navigation ───────────────────────────────────────────────────────────

describe('SPA navigation (history.pushState interception)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('pushState stops active scrolling', () => {
    const listener = loadContent();
    sendMsg(listener, 'start');
    browser.runtime.sendMessage.mockClear();

    history.pushState({}, '', '/new-page');

    const stoppedMsg = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged' && m.isScrolling === false);
    expect(stoppedMsg).toBeTruthy();
  });

  test('after pushState, widget re-injected after 300ms (showWidget=true)', () => {
    loadContent();
    // Remove widget to simulate SPA DOM wipe
    const w = document.getElementById('__aws_widget__');
    if (w) w.remove();

    history.pushState({}, '', '/other-page');
    expect(document.getElementById('__aws_widget__')).toBeNull();

    jest.advanceTimersByTime(300);
    expect(document.getElementById('__aws_widget__')).not.toBeNull();
  });

  test('replaceState also triggers onNavigate', () => {
    const listener = loadContent();
    sendMsg(listener, 'start');
    browser.runtime.sendMessage.mockClear();

    history.replaceState({}, '', '/replaced-page');

    const stoppedMsg = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged' && m.isScrolling === false);
    expect(stoppedMsg).toBeTruthy();
  });
});

// ─── Scroll timer (timerMins) ─────────────────────────────────────────────────

describe('scroll timer (timerMins)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  function findStopMsg() {
    return browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged' && m.isScrolling === false);
  }

  test('timerMins=1 → stopScroll after 60s', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { timerMins: 1 });
    sendMsg(listener, 'start');
    browser.runtime.sendMessage.mockClear();
    jest.advanceTimersByTime(60_000);
    expect(findStopMsg()).toBeTruthy();
  });

  test('timerMins=0 → scroll NOT stopped after 60s', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { timerMins: 0 });
    sendMsg(listener, 'start');
    browser.runtime.sendMessage.mockClear();
    jest.advanceTimersByTime(60_000);
    expect(findStopMsg()).toBeFalsy();
  });

  test('timerMins changed mid-scroll → previous timer cancelled', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { timerMins: 5 });
    sendMsg(listener, 'start');
    jest.advanceTimersByTime(4 * 60_000); // 4분 경과 (5분 타이머 아직 작동 중)
    sendMsg(listener, 'updateSettings', { timerMins: 10 }); // 타이머 재시작
    browser.runtime.sendMessage.mockClear();
    jest.advanceTimersByTime(2 * 60_000); // 추가 2분 (구 타이머라면 이미 종료)
    expect(findStopMsg()).toBeFalsy(); // 새 10분 타이머 아직 작동 중
  });

  test('timerMins set to 0 mid-scroll → timer cleared, scroll continues', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { timerMins: 1 });
    sendMsg(listener, 'start');
    sendMsg(listener, 'updateSettings', { timerMins: 0 }); // 타이머 해제
    browser.runtime.sendMessage.mockClear();
    jest.advanceTimersByTime(60_000);
    expect(findStopMsg()).toBeFalsy();
  });

  test('updateSettings timerMins without active scroll → no timer set', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { timerMins: 1 }); // 스크롤 미실행
    browser.runtime.sendMessage.mockClear();
    jest.advanceTimersByTime(60_000);
    expect(findStopMsg()).toBeFalsy();
  });

  test('timer expiry resets timerMins to 0 in stateChanged notification', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { timerMins: 1 });
    sendMsg(listener, 'start');
    browser.runtime.sendMessage.mockClear();
    jest.advanceTimersByTime(60_000);
    const stopMsg = findStopMsg();
    expect(stopMsg).toBeTruthy();
    expect(stopMsg.settings.timerMins).toBe(0);
  });

  test('timer expiry saves timerMins=0 to localStorage', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { timerMins: 1 });
    sendMsg(listener, 'start');
    jest.advanceTimersByTime(60_000);
    const saved = JSON.parse(localStorage.getItem('aws_settings'));
    expect(saved.timerMins).toBe(0);
  });
});

// ─── Direction change special handling ───────────────────────────────────────

describe('direction change special handling', () => {
  let scrollMock;
  let origGetComputedStyle;

  beforeEach(() => {
    scrollMock = {
      scrollTop:     0,
      scrollHeight:  5000,
      clientHeight:  900,
      scrollBy:      jest.fn(),
      parentElement: document.documentElement,
      style:         { setProperty: jest.fn() },
    };
    origGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = jest.fn(el =>
      el === scrollMock
        ? { overflow: 'scroll', overflowY: 'scroll' }
        : origGetComputedStyle(el)
    );
    document.elementFromPoint = jest.fn(() => scrollMock);
  });

  afterEach(() => { window.getComputedStyle = origGetComputedStyle; });

  test('direction change clears autoPause (userScrolling reset)', () => {
    jest.useFakeTimers();
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { autoPause: true });
    sendMsg(listener, 'start');
    runFrame(0);
    fireTouchStart(); // userScrolling=true
    sendMsg(listener, 'updateSettings', { direction: 'up' }); // userScrolling 리셋
    scrollMock.scrollBy = jest.fn();
    runFrame(1000); // userScrolling=false → scrollBy 호출됨
    expect(scrollMock.scrollBy).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('loop + down→up at top edge: scrollTop repositioned to scrollHeight', () => {
    scrollMock.scrollTop = 1; // 상단 근처 (≤2)
    const listener = loadContent();
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { loop: true, direction: 'down' });
    sendMsg(listener, 'start');
    sendMsg(listener, 'updateSettings', { direction: 'up' });
    expect(scrollMock.scrollTop).toBe(scrollMock.scrollHeight);
  });

  test('loop + up→down at bottom edge: scrollTop repositioned to 0', () => {
    scrollMock.scrollTop = 4101; // 하단 근처
    const listener = loadContent();
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { loop: true, direction: 'up' });
    sendMsg(listener, 'start');
    sendMsg(listener, 'updateSettings', { direction: 'down' });
    expect(scrollMock.scrollTop).toBe(0);
  });

  test('loop=false direction change → no scrollTop repositioning', () => {
    scrollMock.scrollTop = 1;
    const listener = loadContent();
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { loop: false, direction: 'down' });
    sendMsg(listener, 'start');
    sendMsg(listener, 'updateSettings', { direction: 'up' });
    expect(scrollMock.scrollTop).toBe(1);
  });

  test('direction change while not scrolling → no repositioning', () => {
    scrollMock.scrollTop = 1;
    const listener = loadContent();
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { loop: true, direction: 'down' });
    // start 없이 방향 변경
    sendMsg(listener, 'updateSettings', { direction: 'up' });
    expect(scrollMock.scrollTop).toBe(1);
  });
});

// ─── Widget collapse / expand ─────────────────────────────────────────────────

describe('widget collapse / expand', () => {
  beforeEach(() => { loadContent(); });

  test('collapse button click hides slider and speed label', () => {
    document.getElementById('__aws_col_btn__').click();
    expect(document.getElementById('__aws_slider_wrap__').style.display).toBe('none');
    expect(document.getElementById('__aws_speed_label__').style.display).toBe('none');
  });

  test('collapse button text becomes "+" when collapsed', () => {
    document.getElementById('__aws_col_btn__').click();
    expect(document.getElementById('__aws_col_btn__').textContent).toBe('+');
  });

  test('widget width shrinks to 44px on collapse', () => {
    document.getElementById('__aws_col_btn__').click();
    expect(document.getElementById('__aws_widget__').style.width).toBe('44px');
  });

  test('second click expands: slider visible, button shows "–"', () => {
    const colBtn = document.getElementById('__aws_col_btn__');
    colBtn.click(); colBtn.click();
    expect(document.getElementById('__aws_slider_wrap__').style.display).toBe('flex');
    expect(colBtn.textContent).toBe('–');
  });

  test('widget width restored to 52px after expand', () => {
    const colBtn = document.getElementById('__aws_col_btn__');
    colBtn.click(); colBtn.click();
    expect(document.getElementById('__aws_widget__').style.width).toBe('52px');
  });
});

// ─── Widget speed slider ──────────────────────────────────────────────────────

describe('widget speed slider', () => {
  test('slider input updates speed and notifies state', () => {
    const listener = loadContent();
    browser.runtime.sendMessage.mockClear();
    const slider = document.querySelector('#__aws_widget__ input[type=range]');
    slider.value = '12';
    slider.dispatchEvent(new Event('input'));
    const msg = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged');
    expect(msg.settings.speed).toBe(12);
  });

  test('slider input updates speed label immediately', () => {
    loadContent();
    const slider = document.querySelector('#__aws_widget__ input[type=range]');
    slider.value = '15';
    slider.dispatchEvent(new Event('input'));
    expect(document.getElementById('__aws_speed_label__').textContent).toBe('15x');
  });

  test('updateSettings speed syncs widget slider value', () => {
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { speed: 9 });
    expect(document.querySelector('#__aws_widget__ input[type=range]').value).toBe('9');
  });
});

// ─── Widget drag helpers ──────────────────────────────────────────────────────

function fireTouchStartAt(target, clientX = 10, clientY = 10) {
  const evt = new Event('touchstart', { bubbles: true, cancelable: true });
  evt.touches = [{ identifier: 1, target, clientX, clientY }];
  target.dispatchEvent(evt);
}

function fireTouchMoveAt(clientX, clientY) {
  const evt = new Event('touchmove', { bubbles: true, cancelable: true });
  evt.touches = [{ identifier: 1, target: document.body, clientX, clientY }];
  window.dispatchEvent(evt);
}

function fireTouchEndGlobal() {
  const evt = new Event('touchend', { bubbles: true, cancelable: true });
  evt.changedTouches = [];
  document.body.dispatchEvent(evt); // bubbles to window; e.target=document.body (valid Node)
}

// ─── Widget drag ──────────────────────────────────────────────────────────────

describe('widget drag', () => {
  let widget;

  beforeEach(() => {
    loadContent();
    widget = document.getElementById('__aws_widget__');
    widget.getBoundingClientRect = () => ({ left: 100, top: 200, width: 52, height: 180 });
    Object.defineProperty(widget, 'offsetWidth',  { get: () => 52,  configurable: true });
    Object.defineProperty(widget, 'offsetHeight', { get: () => 180, configurable: true });
  });

  test('drag on widget body moves position', () => {
    fireTouchStartAt(widget, 10, 10);
    fireTouchMoveAt(30, 40); // delta=(20,30) → left=120, top=230
    expect(widget.style.left).toBe('120px');
    expect(widget.style.top).toBe('230px');
  });

  test('drag clamps to viewport min boundary (no negative)', () => {
    fireTouchStartAt(widget, 10, 10);
    fireTouchMoveAt(-1000, -1000);
    expect(parseFloat(widget.style.left)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(widget.style.top)).toBeGreaterThanOrEqual(0);
  });

  test('drag clamps to viewport max boundary', () => {
    fireTouchStartAt(widget, 10, 10);
    fireTouchMoveAt(99999, 99999);
    expect(parseFloat(widget.style.left)).toBeLessThanOrEqual(window.innerWidth - 52);
    expect(parseFloat(widget.style.top)).toBeLessThanOrEqual(window.innerHeight - 180);
  });

  test('drag end with movement saves position to localStorage', () => {
    fireTouchStartAt(widget, 10, 10);
    fireTouchMoveAt(30, 40);
    fireTouchEndGlobal();
    const saved = JSON.parse(localStorage.getItem(`aws_widget_pos_${location.hostname}`));
    expect(saved).not.toBeNull();
    expect(typeof saved.x).toBe('number');
  });

  test('drag end without movement does NOT save position', () => {
    fireTouchStartAt(widget, 10, 10);
    fireTouchEndGlobal(); // move 없음 → dragMoved=false
    expect(localStorage.getItem(`aws_widget_pos_${location.hostname}`)).toBeNull();
  });
});

// ─── Widget position restore ──────────────────────────────────────────────────

describe('widget position restore', () => {
  test('valid savedPos restores left/top on widget creation', () => {
    localStorage.setItem(`aws_widget_pos_${location.hostname}`, JSON.stringify({ x: 50, y: 100 }));
    loadContent();
    const w = document.getElementById('__aws_widget__');
    expect(w.style.left).toBe('50px');
    expect(w.style.top).toBe('100px');
  });

  test('NaN position in localStorage falls back to right/bottom default', () => {
    localStorage.setItem(`aws_widget_pos_${location.hostname}`, JSON.stringify({ x: null, y: 100 }));
    loadContent();
    const w = document.getElementById('__aws_widget__');
    // isFinite(null)=false → entire savedPos entry rejected
    // If guard broken: top would be '100px' (stored y value). With guard: not applied.
    expect(w.style.top).not.toBe('100px');
  });
});

// ─── Wake Lock ────────────────────────────────────────────────────────────────

describe('wake lock', () => {
  test('acquireWakeLock called on startScroll', async () => {
    const listener = loadContent();
    sendMsg(listener, 'start');
    // acquireWakeLock is async; flush microtasks
    await Promise.resolve();
    expect(navigator.wakeLock.request).toHaveBeenCalledWith('screen');
  });

  test('releaseWakeLock called on stopScroll', async () => {
    const listener = loadContent();
    sendMsg(listener, 'start');
    await Promise.resolve();
    const sentinel = await navigator.wakeLock.request.mock.results[0].value;
    sendMsg(listener, 'stop');
    expect(sentinel.release).toHaveBeenCalled();
  });

  test('wake lock NOT acquired when not scrolling', async () => {
    loadContent();
    await Promise.resolve();
    expect(navigator.wakeLock.request).not.toHaveBeenCalled();
  });

  test('wake lock re-acquired on visibilitychange while scrolling', async () => {
    const listener = loadContent();
    sendMsg(listener, 'start');
    await Promise.resolve();
    navigator.wakeLock.request.mockClear();

    // Simulate page becoming visible again (e.g. after tab switch)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(navigator.wakeLock.request).toHaveBeenCalledWith('screen');
  });

  test('wake lock NOT re-acquired on visibilitychange when not scrolling', async () => {
    loadContent();
    await Promise.resolve();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(navigator.wakeLock.request).not.toHaveBeenCalled();
  });
});

// ─── Battery — autoPause RAF pause/resume ─────────────────────────────────────

describe('battery — autoPause RAF pause/resume', () => {
  function fireTouchStartOnPage() {
    const evt = new Event('touchstart', { bubbles: true, cancelable: true });
    evt.touches = [{ identifier: 1, target: document.body, clientX: 50, clientY: 50 }];
    document.body.dispatchEvent(evt);
  }

  function fireTouchEndOnPage() {
    const evt = new Event('touchend', { bubbles: true, cancelable: true });
    evt.changedTouches = [];
    evt.touches = [];
    document.body.dispatchEvent(evt);
  }

  test('RAF loop self-terminates when userScrolling=true (autoPause active)', () => {
    jest.useFakeTimers();
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { autoPause: true });
    sendMsg(listener, 'start');
    runFrame(0); // first frame — scrollInterval gets next RAF id

    fireTouchStartOnPage(); // userScrolling = true
    const rafCallsBefore = global.requestAnimationFrame.mock.calls.length;
    runFrame(100); // doScroll should self-terminate → no new RAF enqueued
    expect(global.requestAnimationFrame.mock.calls.length).toBe(rafCallsBefore);
    jest.useRealTimers();
  });

  test('RAF loop restarts after 3s resume timer (touchend path)', () => {
    jest.useFakeTimers();
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { autoPause: true });
    sendMsg(listener, 'start');
    runFrame(0);

    fireTouchStartOnPage(); // userScrolling = true
    runFrame(100);          // RAF self-terminates
    fireTouchEndOnPage();   // starts 3s timer

    // Before timer: RAF should NOT have restarted
    const rafCallsMid = global.requestAnimationFrame.mock.calls.length;
    jest.advanceTimersByTime(2999);
    expect(global.requestAnimationFrame.mock.calls.length).toBe(rafCallsMid);

    // After timer: RAF restarts
    jest.advanceTimersByTime(1);
    expect(global.requestAnimationFrame.mock.calls.length).toBeGreaterThan(rafCallsMid);
    jest.useRealTimers();
  });

  test('RAF loop restarts after 3s resume timer (wheel path)', () => {
    jest.useFakeTimers();
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { autoPause: true });
    sendMsg(listener, 'start');
    runFrame(0);

    // Trigger wheel-based autoPause
    window.dispatchEvent(new Event('wheel'));
    runFrame(100); // RAF self-terminates

    const rafCallsMid = global.requestAnimationFrame.mock.calls.length;
    jest.advanceTimersByTime(3000);
    expect(global.requestAnimationFrame.mock.calls.length).toBeGreaterThan(rafCallsMid);
    jest.useRealTimers();
  });

  test('autoPause=false → touchstart does NOT stop RAF loop', () => {
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'updateSettings', { autoPause: false });
    sendMsg(listener, 'start');
    runFrame(0);

    fireTouchStartOnPage(); // userScrolling should remain false
    const rafCallsBefore = global.requestAnimationFrame.mock.calls.length;
    runFrame(100); // RAF should continue normally
    expect(global.requestAnimationFrame.mock.calls.length).toBeGreaterThan(rafCallsBefore);
  });
});
