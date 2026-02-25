// tests/setup.js — Global mocks for Safari WebExtension browser APIs

// ─── browser global ───────────────────────────────────────────────────────────
const _mockPort = {
  onDisconnect: { addListener: jest.fn() },
  onMessage:    { addListener: jest.fn() },
  postMessage:  jest.fn(),
  disconnect:   jest.fn(),
};

global.browser = {
  runtime: {
    onMessage: { addListener: jest.fn() },
    onConnect: { addListener: jest.fn() },
    sendMessage: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockReturnValue(_mockPort),
  },
  tabs: {
    query: jest.fn().mockResolvedValue([{ id: 1 }]),
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
  storage: {
    local: {
      get:    jest.fn().mockResolvedValue({}),
      set:    jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
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

// ─── navigator.wakeLock ───────────────────────────────────────────────────────
const _wakeLockSentinel = {
  release: jest.fn().mockResolvedValue(undefined),
  addEventListener: jest.fn(),
};
Object.defineProperty(navigator, 'wakeLock', {
  writable: true,
  value: { request: jest.fn().mockResolvedValue(_wakeLockSentinel) },
});

// ─── Reset all mocks before each test ────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();

  // Restore browser mock (clearAllMocks removes implementations)
  global.browser.runtime.onMessage.addListener = jest.fn();
  global.browser.runtime.onConnect.addListener = jest.fn();
  global.browser.runtime.sendMessage           = jest.fn().mockResolvedValue(undefined);
  _mockPort.onDisconnect.addListener           = jest.fn();
  _mockPort.onMessage.addListener              = jest.fn();
  _mockPort.postMessage                        = jest.fn();
  _mockPort.disconnect                         = jest.fn();
  global.browser.runtime.connect              = jest.fn().mockReturnValue(_mockPort);
  global.browser.tabs.query                    = jest.fn().mockResolvedValue([{ id: 1 }]);
  global.browser.tabs.sendMessage              = jest.fn().mockResolvedValue(undefined);
  global.browser.storage.local.get            = jest.fn().mockResolvedValue({});
  global.browser.storage.local.set            = jest.fn().mockResolvedValue(undefined);
  global.browser.storage.local.remove         = jest.fn().mockResolvedValue(undefined);

  // Restore NO-OP RAF
  global.requestAnimationFrame = jest.fn().mockReturnValue(1);
  global.cancelAnimationFrame  = jest.fn();

  // Restore wakeLock mock
  _wakeLockSentinel.release = jest.fn().mockResolvedValue(undefined);
  _wakeLockSentinel.addEventListener = jest.fn();
  navigator.wakeLock.request = jest.fn().mockResolvedValue(_wakeLockSentinel);

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
