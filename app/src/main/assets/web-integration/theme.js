(function () {
  "use strict";
  if (window.__deepseekharnessThemeInstalled) return;
  window.__deepseekharnessThemeInstalled = true;

  var last = "";
  var timer = null;
  var poll = null;

  // DSH web 的主题背景色不是 body 的 backgroundColor（body 是透明的），
  // 而是 CSS 变量 --dsw-alias-bg-base（定义在 body[data-ds-dark-theme] 下，
  // 值形如 var(--dsw-static-neutral-bluish-950)）。自定义属性的 computed
  // value 保留 var() 引用，这里递归把引用链解析成最终颜色值，最多 8 层。
  function resolveCssVar(name, el) {
    var css = getComputedStyle(el);
    var value = css.getPropertyValue(name);
    var depth = 0;
    while (value && /^\s*var\(/.test(value) && depth < 8) {
      var m = /var\(\s*(--[a-zA-Z0-9_-]+)/.exec(value);
      if (!m) break;
      value = css.getPropertyValue(m[1]);
      depth++;
    }
    return value ? value.trim() : "";
  }

  // 空/透明色视为“没拿到”，返回 ""。
  function normalize(color) {
    if (!color) return "";
    var c = String(color).trim();
    if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)" || c === "rgba(0,0,0,0)") return "";
    return c;
  }

  function read() {
    // 1) meta[name=theme-color]（dsh-web-mobile 等插件会维护它）；
    //    但它的值可能来自 body 的透明背景，需要过滤。
    var m = document.querySelector('meta[name="theme-color"]');
    if (m && m.content) {
      var metaColor = normalize(m.content);
      if (metaColor) return metaColor;
    }
    var el = document.body || document.documentElement;
    if (!el) return "";
    // 2) DSH 官方主题变量 --dsw-alias-bg-base：主题切换翻转
    //    body[data-ds-dark-theme] 时该变量随之改变，是状态栏跟色的主来源。
    var alias = normalize(resolveCssVar("--dsw-alias-bg-base", el));
    if (alias) return alias;
    // 3) 兜底：body 的直接背景色（普通网页）。
    var bg = "";
    try { bg = getComputedStyle(el).backgroundColor; } catch (e) { return ""; }
    return normalize(bg);
  }

  function report() {
    var c = read();
    if (c && c !== last) {
      last = c;
      try { console.log("[DeepSeekHarness_THEME] " + c); } catch (e) { }
    }
  }

  // 事件驱动的 debounce 上报（150ms），由 MutationObserver 触发。
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; report(); }, 150);
  }

  function start() {
    // 首帧立即上报一次（readyState 非 loading 时样式表可能尚未生效，
    // 靠下面的兜底轮询在样式就绪后补报）。
    report();
    try {
      // 观察整棵树的属性/子节点变化：body[data-ds-dark-theme] 翻转、
      // meta theme-color 更新、UI 容器插入都会触发。
      new MutationObserver(schedule).observe(document.documentElement, {
        subtree: true, childList: true, attributes: true
      });
      // body 的主题属性单独再盯一层（个别内核下 subtree 观察可能漏报 body 自身属性）。
      if (document.body) {
        new MutationObserver(schedule).observe(document.body, {
          attributes: true, attributeFilter: ["data-ds-dark-theme", "class", "style"]
        });
      }
    } catch (e) { }
    // 兜底轮询：主题可能在脚本运行后才设置、MutationObserver 事件也可能
    // 丢失或晚到。1s 一次，last 去重保证颜色不变时零消息。
    if (!poll) {
      poll = setInterval(function () { report(); }, 1000);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();