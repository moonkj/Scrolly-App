// tests/popup.test.js — Tests for popup.js (IIFE, DOM-coupled)

const path = require('path');
const POPUP_PATH = path.resolve(__dirname, '../ios/SafariExtension/Resources/popup.js');

// Force Korean locale so i18n resolves to Korean strings (matching original test assertions)
Object.defineProperty(navigator, 'language', { get: () => 'ko', configurable: true });

// Minimal popup.html DOM structure (mirrors popup.html elements)
const POPUP_DOM = `
  <button id="toggleBtn" class="toggle-btn stopped">
    <span class="btn-icon">▶︎</span>
    <span class="btn-label">시작</span>
  </button>
  <div class="status-dot" id="statusDot"></div>

  <input type="range" id="speedSlider" min="1" max="20" step="1" value="3">
  <span id="speedValue">3x</span>

  <div id="directionControl">
    <button class="seg-btn active" data-value="down">↓ 아래</button>
    <button class="seg-btn"        data-value="up">↑ 위</button>
  </div>

  <input type="checkbox" id="loopToggle">
  <input type="checkbox" id="autoPauseToggle" checked>
  <input type="checkbox" id="gestureToggle"   checked>
  <input type="checkbox" id="showWidgetToggle" checked>

  <input type="range"  id="timerSlider" min="0" max="60" step="5" value="0">
  <span id="timerValue">끔</span>
`;

// Helper: inject DOM + eval popup.js → returns the runtime message listener
function loadPopup() {
  document.body.innerHTML = POPUP_DOM; // DOM must be ready before popup.js IIFE runs
  jest.resetModules();
  require(POPUP_PATH);
  // popup.js registers a listener via browser.runtime.onMessage.addListener
  const calls = browser.runtime.onMessage.addListener.mock.calls;
  if (calls.length === 0) return null;
  return calls[calls.length - 1][0];
}

// ─── Initial render ───────────────────────────────────────────────────────────

describe('renderUI — initial state (stopped)', () => {
  test('toggleBtn has class "stopped"', () => {
    loadPopup();
    expect(document.getElementById('toggleBtn').className).toContain('stopped');
  });

  test('btn-icon shows play symbol', () => {
    loadPopup();
    const icon = document.querySelector('.btn-icon');
    expect(icon.textContent).toContain('\u25B6');
  });

  test('btn-label shows "시작"', () => {
    loadPopup();
    const label = document.querySelector('.btn-label');
    expect(label.textContent).toBe('시작');
  });

  test('statusDot does not have "active" class', () => {
    loadPopup();
    expect(document.getElementById('statusDot').classList.contains('active')).toBe(false);
  });

  test('speedValue shows "3x" (default speed)', () => {
    loadPopup();
    expect(document.getElementById('speedValue').textContent).toBe('3x');
  });

  test('timerValue shows "끔" (timer off)', () => {
    loadPopup();
    expect(document.getElementById('timerValue').textContent).toBe('끔');
  });

  test('on init, sends getState to content script', async () => {
    loadPopup();
    await Promise.resolve(); // flush microtasks for async tabs.query
    expect(browser.tabs.query).toHaveBeenCalled();
  });
});

// ─── applyState — stateChanged message ────────────────────────────────────────

describe('applyState via stateChanged message', () => {
  let msgListener;
  beforeEach(() => { msgListener = loadPopup(); });

  test('scrolling=true → toggleBtn class "running"', () => {
    msgListener({ name: 'stateChanged', isScrolling: true, settings: {} });
    expect(document.getElementById('toggleBtn').className).toContain('running');
  });

  test('scrolling=true → btn-icon shows pause symbol', () => {
    msgListener({ name: 'stateChanged', isScrolling: true, settings: {} });
    expect(document.querySelector('.btn-icon').textContent).toContain('\u23F8');
  });

  test('scrolling=true → btn-label shows "정지"', () => {
    msgListener({ name: 'stateChanged', isScrolling: true, settings: {} });
    expect(document.querySelector('.btn-label').textContent).toBe('정지');
  });

  test('scrolling=true → statusDot gets "active" class', () => {
    msgListener({ name: 'stateChanged', isScrolling: true, settings: {} });
    expect(document.getElementById('statusDot').classList.contains('active')).toBe(true);
  });

  test('scrolling=false → back to stopped state', () => {
    msgListener({ name: 'stateChanged', isScrolling: true, settings: {} });
    msgListener({ name: 'stateChanged', isScrolling: false, settings: {} });
    expect(document.getElementById('toggleBtn').className).toContain('stopped');
    expect(document.getElementById('statusDot').classList.contains('active')).toBe(false);
  });

  test('settings from stateChanged updates speedSlider and speedValue', () => {
    msgListener({ name: 'stateChanged', isScrolling: false, settings: { speed: 9 } });
    expect(document.getElementById('speedSlider').value).toBe('9');
    expect(document.getElementById('speedValue').textContent).toBe('9x');
  });

  test('settings timerMins > 0 → timerValue shows "N분"', () => {
    msgListener({ name: 'stateChanged', isScrolling: false, settings: { timerMins: 30 } });
    expect(document.getElementById('timerValue').textContent).toBe('30분');
  });

  test('settings direction updates active seg-btn', () => {
    msgListener({ name: 'stateChanged', isScrolling: false, settings: { direction: 'up' } });
    const btns = document.querySelectorAll('#directionControl .seg-btn');
    const upBtn   = Array.from(btns).find(b => b.dataset.value === 'up');
    const downBtn = Array.from(btns).find(b => b.dataset.value === 'down');
    expect(upBtn.classList.contains('active')).toBe(true);
    expect(downBtn.classList.contains('active')).toBe(false);
  });

  test('non-stateChanged message is ignored', () => {
    // Should not throw
    expect(() => msgListener({ name: 'somethingElse' })).not.toThrow();
  });
});

// ─── User interactions ────────────────────────────────────────────────────────

describe('toggleBtn click', () => {
  test('sends "toggle" to content tab', async () => {
    loadPopup();
    document.getElementById('toggleBtn').click();
    await Promise.resolve();
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'toggle' })
    );
  });

  test('optimistic UI flip: stopped → running immediately', () => {
    loadPopup();
    document.getElementById('toggleBtn').click();
    expect(document.getElementById('toggleBtn').className).toContain('running');
  });
});

describe('speedSlider input', () => {
  test('updates speedValue and sends updateSettings', async () => {
    loadPopup();
    const slider = document.getElementById('speedSlider');
    slider.value = '8';
    slider.dispatchEvent(new Event('input'));
    await Promise.resolve();
    expect(document.getElementById('speedValue').textContent).toBe('8x');
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'updateSettings', message: expect.objectContaining({ speed: 8 }) })
    );
  });
});

describe('direction seg-btn click', () => {
  test('sets direction and sends updateSettings', async () => {
    loadPopup();
    const upBtn = Array.from(document.querySelectorAll('#directionControl .seg-btn'))
      .find(b => b.dataset.value === 'up');
    upBtn.click();
    await Promise.resolve();
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'updateSettings', message: expect.objectContaining({ direction: 'up' }) })
    );
  });
});

describe('timerSlider input', () => {
  test('timer=0 → timerValue "끔"', () => {
    loadPopup();
    const slider = document.getElementById('timerSlider');
    slider.value = '0';
    slider.dispatchEvent(new Event('input'));
    expect(document.getElementById('timerValue').textContent).toBe('끔');
  });

  test('timer=30 → timerValue "30분"', () => {
    loadPopup();
    const slider = document.getElementById('timerSlider');
    slider.value = '30';
    slider.dispatchEvent(new Event('input'));
    expect(document.getElementById('timerValue').textContent).toBe('30분');
  });
});

describe('showWidgetToggle change', () => {
  test('unchecking sends "hideWidget" message', async () => {
    loadPopup();
    const toggle = document.getElementById('showWidgetToggle');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'hideWidget' })
    );
  });

  test('checking sends "showWidget" message', async () => {
    loadPopup();
    const toggle = document.getElementById('showWidgetToggle');
    // First uncheck
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    browser.tabs.sendMessage.mockClear();
    // Then re-check
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'showWidget' })
    );
  });
});

describe('loopToggle change', () => {
  test('sends updateSettings with loop=true', async () => {
    loadPopup();
    const toggle = document.getElementById('loopToggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'updateSettings', message: expect.objectContaining({ loop: true }) })
    );
  });
});
