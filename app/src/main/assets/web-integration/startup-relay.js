// Gecko 页面世界报告只传入现有同源只读诊断通道。
if (window.top === window) {
  window.__deepseekharnessStartupPort = browser.runtime.connectNative('deepseekharness');
  window.addEventListener('deepseekharness-startup', event => {
    if (typeof event.detail !== 'string' || event.detail.length > 9000) return;
    try { window.__deepseekharnessStartupPort.postMessage({type:'startup', report:JSON.parse(event.detail)}); } catch (_) {}
  });
}
