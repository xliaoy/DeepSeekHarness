if (window.top === window) {
  const port = window.__deepseekharnessStartupPort || browser.runtime.connectNative('deepseekharness');
  port.onMessage.addListener(message => {
    if (message?.type === 'back' && Number.isSafeInteger(message.id)) {
      let handled = false;
      try { handled = window.__deepseekharnessPageBack(); } catch {}
      port.postMessage({type:'back', id:message.id, handled});
      return;
    }
    // DeepSeekHarness 沉浸式：状态栏高度 → body padding-top（内容下移安全区，背景延伸状态栏）。
    if (message?.type === 'safe-top' && Number.isFinite(message.top)) {
      try { document.body.style.paddingTop = message.top + 'px'; } catch (_) {}
    }
  });
}
