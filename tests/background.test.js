// tests/background.test.js — Tests for background.js (stateless relay)

const path = require('path');
const BACKGROUND_PATH = path.resolve(__dirname, '../ios/SafariExtension/Resources/background.js');

function loadBackground() {
  jest.resetModules();
  require(BACKGROUND_PATH);
  const calls = browser.runtime.onMessage.addListener.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0]; // the relay listener
}

describe('background.js message relay', () => {
  test('stateChanged from a tab → forwarded via runtime.sendMessage', () => {
    const relay = loadBackground();
    relay({ name: 'stateChanged', isScrolling: false }, { tab: { id: 1 } });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'stateChanged' })
    );
  });

  test('stateChanged without sender.tab → NOT forwarded', () => {
    const relay = loadBackground();
    relay({ name: 'stateChanged', isScrolling: false }, {});
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('non-stateChanged message from tab → NOT forwarded', () => {
    const relay = loadBackground();
    relay({ name: 'toggle' }, { tab: { id: 1 } });
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('non-stateChanged message without tab → NOT forwarded', () => {
    const relay = loadBackground();
    relay({ name: 'updateSettings' }, {});
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('relay resolves without throwing when popup is closed (sendMessage rejects)', async () => {
    const relay = loadBackground();
    browser.runtime.sendMessage.mockRejectedValueOnce(new Error('popup closed'));
    // Should not throw
    await expect(
      new Promise(resolve => {
        relay({ name: 'stateChanged' }, { tab: { id: 1 } });
        resolve();
      })
    ).resolves.toBeUndefined();
  });
});
