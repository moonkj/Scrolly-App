// tests/setup.js — Global mocks for Safari WebExtension browser APIs

// ─── browser global ───────────────────────────────────────────────────────────
global.browser = {
  runtime: {
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
  tabs: {
    query: jest.fn().mockResolvedValue([{ id: 1 }]),
    sendMessage: jest.fn(),
  },
};

// ─── requestAnimationFrame — NO-OP by default ─────────────────────────────────
// Tests that need RAF execution use a controlled queue (createRafQueue helper).
// Keeping it as a NO-OP prevents infinite recursion from the scroll loop.
global.requestAnimationFrame = jest.fn().mockReturnValue(1);
global.cancelAnimationFrame  = jest.fn();

// ─── window.matchMedia ────────────────────────────────────────────────────────
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockReturnValue({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }),
});

// ─── Preserve original history methods for restoration ────────────────────────
const _origPushState    = history.pushState.bind(history);
const _origReplaceState = history.replaceState.bind(history);

// ─── Reset all mocks before each test ────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();

  // Restore browser mock (clearAllMocks removes implementations)
  global.browser.runtime.onMessage.addListener = jest.fn();
  global.browser.runtime.sendMessage           = jest.fn().mockResolvedValue(undefined);
  global.browser.tabs.query                    = jest.fn().mockResolvedValue([{ id: 1 }]);
  global.browser.tabs.sendMessage              = jest.fn();

  // Restore NO-OP RAF
  global.requestAnimationFrame = jest.fn().mockReturnValue(1);
  global.cancelAnimationFrame  = jest.fn();

  // Restore matchMedia
  window.matchMedia = jest.fn().mockReturnValue({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });

  // Restore history methods that content.js may have intercepted
  history.pushState    = _origPushState;
  history.replaceState = _origReplaceState;

  // Clear localStorage and DOM
  localStorage.clear();
  document.body.innerHTML = '';
});
