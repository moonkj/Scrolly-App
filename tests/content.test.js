// tests/content.test.js — Tests for content.js (IIFE, loaded via eval)

const fs   = require('fs');
const path = require('path');

const CONTENT_JS = fs.readFileSync(
  path.join(__dirname, '../ios/SafariExtension/Resources/content.js'),
  'utf-8'
);

// ─── Window listener cleanup ─────────────────────────────────────────────────
// content.js adds event listeners to `window` on every eval(). Without cleanup
// they accumulate across tests, causing stale closures to fire.

const _origWAEL = window.addEventListener.bind(window);
let _addELSpy   = null;
let _addedListeners = [];

beforeEach(() => {
  _addedListeners = [];
  _addELSpy = jest.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => {
    _addedListeners.push({ type, fn });
    _origWAEL(type, fn, opts);
  });
});

afterEach(() => {
  _addELSpy?.mockRestore();
  _addELSpy = null;
  _addedListeners.forEach(({ type, fn }) => window.removeEventListener(type, fn));
  _addedListeners = [];
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
function loadContent() {
  // Stub scrollBy (jsdom doesn't implement it)
  document.documentElement.scrollBy = jest.fn();
  document.documentElement.scrollHeight = 5000;
  document.documentElement.scrollTop    = 0;
  document.documentElement.clientHeight = 900;

  // elementFromPoint → return documentElement (simplest: no inner scroll container)
  document.elementFromPoint = jest.fn(() => document.documentElement);

  // eslint-disable-next-line no-eval
  eval(CONTENT_JS);

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
    browser.runtime.sendMessage.mockClear();
    fireTouchStart();
    fireTouchStart();
    jest.advanceTimersByTime(500);
    const started = browser.runtime.sendMessage.mock.calls.map(c => c[0])
      .find(m => m && m.name === 'stateChanged' && m.isScrolling === true);
    expect(started).toBeFalsy();
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
