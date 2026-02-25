// tests/background.test.js — Tests for background.js (stateless relay)

const fs   = require('fs');
const path = require('path');

const BACKGROUND_JS = fs.readFileSync(
  path.join(__dirname, '../ios/SafariExtension/Resources/background.js'),
  'utf-8'
);

function loadBackground() {
  // eslint-disable-next-line no-eval
  eval(BACKGROUND_JS);
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
