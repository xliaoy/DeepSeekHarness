/* 仅处理网页已展示的最上层。普通历史回退由原生处理。 */
window.__deepseekharnessPageBack = function () {
  const visible = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const layers = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [role="menu"], [data-trigger-menu], dialog[open]')).filter(visible);
  const top = layers[layers.length - 1];
  const escape = target => (target || document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true, cancelable:true}));
  if (top) {
    // 使用组件已有的 Escape 处理，原生不移除 React 持有的 DOM。
    const focus = document.activeElement;
    escape(top.contains(focus) ? focus : top);
    return true;
  }
  const frame = document.querySelector('[data-mobile-nav="frame"]');
  // 手机底部弹层（文件树 explorer / 文件预览 preview）：返回时优先关闭。
  // 这两个弹层由 frame 标记控制显隐，若不清理，返回后弹层会残留在屏幕上。
  if (frame && frame.hasAttribute('data-aionui-explorer-open')) {
    frame.removeAttribute('data-aionui-explorer-open');
    return true;
  }
  if (frame && frame.hasAttribute('data-aionui-preview-open')) {
    frame.removeAttribute('data-aionui-preview-open');
    frame.removeAttribute('data-mobile-preview-full');
    return true;
  }
  if (visible(frame) && !frame.hasAttribute('data-sidebar-collapsed')) { escape(); return true; }
  // 新版文件与预览由右侧面板控制器关闭，不能只改布局宽度而留下展开状态。
  const panel = document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]');
  if (visible(panel)) {
    document.documentElement.removeAttribute('data-deepseekharness-back-handled');
    document.dispatchEvent(new CustomEvent('deepseekharness-close-details'));
    if (document.documentElement.getAttribute('data-deepseekharness-back-handled') === 'true') return true;
  }
  return false;
};
