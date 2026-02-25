// background.js – Safari Web Extension message relay

// Relay: content script → popup
// (content sends via browser.runtime.sendMessage; background forwards to popup)
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.name === 'stateChanged' && sender.tab) {
    // Forward to popup (all non-tab listeners)
    browser.runtime.sendMessage(msg).catch(() => {
      // Popup may be closed – safe to ignore
    });
  }
});
