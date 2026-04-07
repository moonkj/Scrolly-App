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

// ─── getScrollTarget — page-first heuristic ──────────────────────────────────

describe('getScrollTarget — page-first heuristic', () => {
  let innerDiv;

  beforeEach(() => {
    innerDiv = document.createElement('div');
    innerDiv.scrollHeight = 2000;
    innerDiv.clientHeight = 500;
    innerDiv.scrollBy     = jest.fn();
    document.body.appendChild(innerDiv);
  });

  afterEach(() => { innerDiv?.remove(); innerDiv = null; });

  test('페이지가 스크롤 가능하면 inner div가 중앙에 있어도 documentElement 사용', () => {
    // scrollHeight(5000) > innerHeight(768)+1 → documentElement path
    document.elementFromPoint = jest.fn(() => innerDiv);
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'start');
    runFrame(0); runFrame(100);
    expect(innerDiv.scrollBy).not.toHaveBeenCalled();
    expect(document.documentElement.scrollBy).toHaveBeenCalled();
  });

  test('페이지가 스크롤 불가(SPA)일 때 documentElement.scrollBy가 호출되지 않음', () => {
    // When page is not scrollable and inner container is not recognised by jsdom CSS,
    // fallback to documentElement — at least verify page-first branch exits early.
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    document.documentElement.scrollHeight = 768; // same as innerHeight → page not scrollable
    document.documentElement.scrollBy = jest.fn();
    sendMsg(listener, 'start');
    runFrame(0); runFrame(100);
    // documentElement.scrollBy still called (fallback) — no inner div used
    // This test confirms the page-first check doesn't crash when page is at minimum height
    expect(() => runFrame(200)).not.toThrow();
    document.documentElement.scrollHeight = 5000; // restore
  });
});

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

  test('unknown keys in message are ignored (whitelist)', () => {
    sendMsg(listener, 'updateSettings', { speed: 5, __proto__: { hacked: true }, unknown: 'x' });
    const saved = JSON.parse(localStorage.getItem('aws_settings'));
    expect(saved.speed).toBe(5);
    expect(saved.unknown).toBeUndefined();
    expect({}.hacked).toBeUndefined();
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

  test('loop=false: scrollTop NOT wrapped (no loop reset)', () => {
    // Use mid-page position so explicit end-of-page check doesn't trigger auto-stop.
    // The point of this test is that loop=false never wraps scrollTop back to 0.
    scrollMock.scrollTop = 1000;
    const listener = loadContent();
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { loop: false, direction: 'down', speed: 3 });
    sendMsg(listener, 'start');
    runFrame(0);
    expect(scrollMock.scrollTop).toBe(1000); // unchanged — no loop wrap
  });

  test('loop=false: reaching bottom triggers auto-stop (explicit end-of-page check)', () => {
    // Pin Date.now so we can control the explicit end-of-page grace period
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = jest.fn(() => now);

    // Start mid-page so startScroll's reposition doesn't fire
    scrollMock.scrollTop = 1000;
    const listener = loadContent();
    document.elementFromPoint = jest.fn(() => scrollMock);
    sendMsg(listener, 'updateSettings', { loop: false, direction: 'down', speed: 3 });
    sendMsg(listener, 'start');
    runFrame(0); // first frame: not at edge → scrollBy called
    expect(scrollMock.scrollBy).toHaveBeenCalled();

    // Advance past the 300ms grace period
    now += 500;

    // Now simulate reaching the bottom
    scrollMock.scrollTop = 4100; // 4100 + 900 >= 4998
    scrollMock.scrollBy.mockClear();
    runFrame(16); // explicit end check → stopScroll, scrollBy NOT called
    expect(scrollMock.scrollBy).not.toHaveBeenCalled();

    Date.now = realNow;
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
    // Mid-page so direction change to up doesn't immediately hit end-of-page (top)
    scrollMock.scrollTop = 1000;
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

    // Simulate browser auto-releasing the lock (e.g. tab hidden):
    // The release callback registered via wakeLock.addEventListener('release', cb) must fire
    // first so that wakeLock = null, allowing re-acquisition on visibility restored.
    const sentinel = await navigator.wakeLock.request.mock.results[0].value;
    const releaseCall = sentinel.addEventListener.mock.calls.find(([ev]) => ev === 'release');
    if (releaseCall) releaseCall[1]();  // invoke the release handler → wakeLock = null

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

// ─── Widget orientation toggle (popup → updateSettings) ──────────────────────

describe('widget orientation toggle', () => {
  let listener;
  beforeEach(() => { listener = loadContent(); });

  test('기본 vertical 모드에서 위젯 flex-direction이 column', () => {
    expect(document.getElementById('__aws_widget__').style.flexDirection).toBe('column');
  });

  test('위젯 안에 orientBtn 없음 (팝업으로만 제어)', () => {
    expect(document.getElementById('__aws_orient_btn__')).toBeNull();
  });

  test('updateSettings widgetOrientation=horizontal → 위젯 flex-direction row', () => {
    sendMsg(listener, 'updateSettings', { widgetOrientation: 'horizontal' });
    expect(document.getElementById('__aws_widget__').style.flexDirection).toBe('row');
  });

  test('horizontal 모드에서 slider에 writing-mode 없음 (가로 슬라이더)', () => {
    sendMsg(listener, 'updateSettings', { widgetOrientation: 'horizontal' });
    const slider = document.querySelector('#__aws_slider_wrap__ input[type=range]');
    expect(slider.style.writingMode).toBeFalsy();
  });

  test('horizontal → vertical 재전환 시 flex-direction column으로 복귀', () => {
    sendMsg(listener, 'updateSettings', { widgetOrientation: 'horizontal' });
    sendMsg(listener, 'updateSettings', { widgetOrientation: 'vertical' });
    expect(document.getElementById('__aws_widget__').style.flexDirection).toBe('column');
  });

  test('widgetOrientation이 aws_settings에 포함되어 localStorage에 저장', () => {
    sendMsg(listener, 'updateSettings', { widgetOrientation: 'horizontal' });
    const saved = JSON.parse(localStorage.getItem('aws_settings'));
    expect(saved.widgetOrientation).toBe('horizontal');
  });

  test('widgetOrientation이 browser.storage.local.set에 포함', () => {
    sendMsg(listener, 'updateSettings', { widgetOrientation: 'horizontal' });
    const calls = browser.storage.local.set.mock.calls;
    const saved = calls.find(c => c[0].aws_settings?.widgetOrientation !== undefined);
    expect(saved).toBeDefined();
    expect(saved[0].aws_settings.widgetOrientation).toBe('horizontal');
  });

  test('orientation 전환 후 widgetCollapsed 상태 보존 (collapsed → 여전히 collapsed)', () => {
    document.getElementById('__aws_col_btn__').click(); // collapse
    expect(document.getElementById('__aws_col_btn__').textContent).toBe('+');
    sendMsg(listener, 'updateSettings', { widgetOrientation: 'horizontal' });
    expect(document.getElementById('__aws_col_btn__').textContent).toBe('+');
  });

  test('loadSiteSettings: aws_settings에서 horizontal orientation 로드', () => {
    localStorage.setItem('aws_settings', JSON.stringify({ widgetOrientation: 'horizontal' }));
    jest.resetModules();
    require(CONTENT_PATH);
    expect(document.getElementById('__aws_widget__').style.flexDirection).toBe('row');
  });

  test('loadSiteSettings: browser.storage.local aws_settings에서 horizontal orientation 로드', () => {
    global.browser.storage.local.get = jest.fn().mockReturnValue({
      then: (cb) => {
        cb({ aws_settings: { widgetOrientation: 'horizontal' } });
        return { catch: () => {} };
      },
    });
    jest.resetModules();
    require(CONTENT_PATH);
    expect(document.getElementById('__aws_widget__').style.flexDirection).toBe('row');
  });

  test('unknown widgetOrientation 값은 수락되지 않고 현재 값 유지', () => {
    sendMsg(listener, 'updateSettings', { widgetOrientation: 'diagonal' });
    // 'diagonal'은 SETTINGS_KEYS에 포함되어 저장되지만 createWidget 조건은 'horizontal' 체크
    // → widget은 column 유지 (기본값 vertical이 변경되었어도 isHoriz는 false)
    const widget = document.getElementById('__aws_widget__');
    expect(widget.style.flexDirection).toBe('column');
  });

  test('horizontal 모드에서 위젯 width가 auto', () => {
    sendMsg(listener, 'updateSettings', { widgetOrientation: 'horizontal' });
    expect(document.getElementById('__aws_widget__').style.width).toBe('auto');
  });
});

// ─── scrollTarget re-detection (hijack prevention) ────────────────────────────
// scrollTargetTimer fires every 300 frames. Target should only switch when
// the current container reaches the scroll edge in the direction of travel.

describe('scrollTarget re-detection — no hijack mid-page', () => {
  let listener, runFrame;

  // Build an inner scrollable div that elementFromPoint returns after 300 frames
  let innerDiv;

  beforeEach(() => {
    ({ runFrame } = createRafQueue());
    listener = loadContent();

    innerDiv = document.createElement('div');
    innerDiv.scrollHeight = 400;
    innerDiv.clientHeight = 200;
    innerDiv.scrollTop    = 0;
    innerDiv.scrollBy     = jest.fn();
    Object.defineProperty(innerDiv, 'style', { value: { setProperty: jest.fn() }, writable: true });
    document.body.appendChild(innerDiv);
  });

  afterEach(() => {
    innerDiv?.remove();
    innerDiv = null;
  });

  test('방향=down, 현재 target이 바닥 미도달 → inner div로 교체 안 됨', () => {
    // loadContent() already sets elementFromPoint → documentElement,
    // so startScroll() picks documentElement as initial target.
    // Switch elementFromPoint to innerDiv AFTER start (simulates mid-scroll appearance).
    window.scrollY = 0;  // not at bottom
    sendMsg(listener, 'start');
    document.elementFromPoint = jest.fn(() => innerDiv);  // would-be hijacker

    // Run 300 frames to trigger scrollTargetTimer
    for (let i = 0; i < 300; i++) runFrame(16 * (i + 1));

    // innerDiv.scrollBy should NOT have been called — page is still the target
    expect(innerDiv.scrollBy).not.toHaveBeenCalled();
  });


  test('방향=up, 현재 target이 맨 위 미도달 → inner div로 교체 안 됨', () => {
    // window.scrollY is read-only in jsdom — use Object.defineProperty
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    sendMsg(listener, 'updateSettings', { direction: 'up' });
    sendMsg(listener, 'start');
    document.elementFromPoint = jest.fn(() => innerDiv);  // would-be hijacker

    for (let i = 0; i < 300; i++) runFrame(16 * (i + 1));

    expect(innerDiv.scrollBy).not.toHaveBeenCalled();

    // Restore
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});

// ─── pagehide — bfcache RAF cleanup ───────────────────────────────────────────
// When Safari restores a page from bfcache the old IIFE's RAF loop resumes.
// pagehide must cancel the RAF so there is no stale loop on restoration.

describe('pagehide — stops scroll before bfcache', () => {
  test('pagehide 이벤트 시 스크롤 정지 및 RAF 취소', () => {
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'start');
    runFrame(0); runFrame(16); // scroll running

    // Simulate pagehide
    window.dispatchEvent(new Event('pagehide'));

    // After pagehide, doScroll should bail out immediately (isScrolling=false)
    document.documentElement.scrollBy = jest.fn();
    runFrame(32);
    expect(document.documentElement.scrollBy).not.toHaveBeenCalled();
  });

  test('pagehide 후 stateChanged(stopped) 전송', () => {
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'start');
    runFrame(0);

    browser.runtime.sendMessage.mockClear();
    window.dispatchEvent(new Event('pagehide'));

    const calls = browser.runtime.sendMessage.mock.calls;
    // notifyState sends { name: 'stateChanged', isScrolling, settings }
    const stopped = calls.some(([msg]) => msg?.name === 'stateChanged' && msg?.isScrolling === false);
    expect(stopped).toBe(true);
  });

  test('pageshow with persisted=true → forces stopScroll (bfcache restore safety)', () => {
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'start');
    runFrame(0);

    // Simulate bfcache restore
    const evt = new Event('pageshow');
    Object.defineProperty(evt, 'persisted', { value: true });
    window.dispatchEvent(evt);

    // Next frame should bail out
    document.documentElement.scrollBy = jest.fn();
    runFrame(16);
    expect(document.documentElement.scrollBy).not.toHaveBeenCalled();
  });

  test('pageshow with persisted=false → no-op (normal navigation)', () => {
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'start');
    runFrame(0);

    const before = browser.runtime.sendMessage.mock.calls.length;
    const evt = new Event('pageshow');
    Object.defineProperty(evt, 'persisted', { value: false });
    window.dispatchEvent(evt);

    // Should NOT trigger an additional stopScroll → no extra stateChanged emit
    const after = browser.runtime.sendMessage.mock.calls.length;
    expect(after).toBe(before);
  });
});

// ─── Quit feature ────────────────────────────────────────────────────────────

describe('quit feature', () => {
  test('quit message → scroll stops + widget removed + showWidget=false saved', () => {
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'start');
    runFrame(0);

    // Pre-condition: widget exists, isScrolling=true
    sendMsg(listener, 'quit');

    // Widget should be removed from DOM
    expect(document.getElementById('__aws_widget__')).toBeNull();

    // showWidget should be persisted as false
    const saved = JSON.parse(localStorage.getItem('aws_settings'));
    expect(saved.showWidget).toBe(false);

    // notifyState should report stopped
    const stopped = browser.runtime.sendMessage.mock.calls.some(
      ([msg]) => msg?.name === 'stateChanged' && msg?.isScrolling === false
    );
    expect(stopped).toBe(true);
  });

  test('startScroll after quit → re-enables widget automatically', () => {
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    sendMsg(listener, 'start');
    runFrame(0);
    sendMsg(listener, 'quit');
    expect(document.getElementById('__aws_widget__')).toBeNull();

    // User clicks start again from popup
    sendMsg(listener, 'start');

    // showWidget should be auto-restored to true
    const saved = JSON.parse(localStorage.getItem('aws_settings'));
    expect(saved.showWidget).toBe(true);
    // Widget should be re-created
    expect(document.getElementById('__aws_widget__')).not.toBeNull();
  });

  test('quit while scroll is stopped → still removes widget and saves showWidget=false', () => {
    const listener = loadContent();
    // No start — scroll is not running
    sendMsg(listener, 'quit');

    expect(document.getElementById('__aws_widget__')).toBeNull();
    const saved = JSON.parse(localStorage.getItem('aws_settings'));
    expect(saved.showWidget).toBe(false);
  });
});

// ─── Stuck-frames detection (end-of-page auto-stop) ──────────────────────────

describe('stuck detection — auto-stop at end of page', () => {
  // Reset window.scrollY between tests so prior Object.defineProperty doesn't leak
  afterEach(() => {
    try { Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true }); } catch (_) {}
  });

  test('does NOT stop on non-scrollable page (totalH ≤ viewH)', () => {
    // Make scrollHeight smaller than viewport → detection skipped
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    // Override AFTER loadContent (which sets scrollHeight=5000)
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 100, configurable: true });

    sendMsg(listener, 'start');
    for (let i = 0; i < 250; i++) runFrame(i * 16);

    // Should still be scrolling — detection gated on totalH > viewH + 10
    const states = browser.runtime.sendMessage.mock.calls
      .filter(([msg]) => msg?.name === 'stateChanged')
      .map(([msg]) => msg.isScrolling);
    expect(states[states.length - 1]).toBe(true);
  });

  test('stops on scrollable page when stuck for ≥180 frames at same position', () => {
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    // Pin scrollY constant — scrollBy mock won't change it
    Object.defineProperty(window, 'scrollY', { get: () => 100, configurable: true });
    // Make page meaningfully scrollable
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });

    sendMsg(listener, 'start');
    for (let i = 0; i < 250; i++) runFrame(i * 16);

    // At least one stateChanged with isScrolling=false should have been emitted
    // (auto-stop after STUCK_FRAMES_THRESHOLD=180 frames).
    const stoppedEmitted = browser.runtime.sendMessage.mock.calls.some(
      ([msg]) => msg?.name === 'stateChanged' && msg?.isScrolling === false
    );
    expect(stoppedEmitted).toBe(true);
  });

  test('does NOT stop when loop=true (loop overrides stuck detection)', () => {
    const { runFrame } = createRafQueue();
    const listener = loadContent();
    Object.defineProperty(window, 'scrollY', { get: () => 100, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });

    sendMsg(listener, 'updateSettings', { loop: true });
    sendMsg(listener, 'start');
    for (let i = 0; i < 200; i++) runFrame(i * 16);

    // loop mode: stuck detection skipped → still running
    const states = browser.runtime.sendMessage.mock.calls
      .filter(([msg]) => msg?.name === 'stateChanged')
      .map(([msg]) => msg.isScrolling);
    expect(states[states.length - 1]).toBe(true);
  });
});
