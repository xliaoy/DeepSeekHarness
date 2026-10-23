(() => {
  try {
    /* 无限五代 (dsh-infinite-gen-5) client half — 原生风格状态条 + 设置台 v0.11.1 */
    window.__ModuleLoader__.load({
      id: "dsh-infinite-gen-5",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        var react = require("react");

        // ────────────────────────────────────────────────────────────────────
        // 位置（v0.5.2 的核心修正）
        //
        // v0.5.1 之前挂在 conversation.input.dock —— 那是「输入框之上」的那一列，
        // 官方 TodoPanel(id:"todo", order:0) 与队列(id:"queue", order:20) 也住在那
        // 一列。我们 order:30 排第三，于是徽标被夹在任务列表和输入框之间，生成任务
        // 时还会跟着任务列表一起把这一列顶动。
        //
        // 改成 conversation.composer.dock —— 那是输入框卡片**自己**的底部 dock 行
        // (InputBar.dock, justify-content:center; gap:12px)，原生「上下文计量器」
        // ContextMeter 就住在这里。同一排、同级、跟任务列表完全无关；生成期间
        // ContextMeter 让位，这一行正好空出来当运行指示器。
        //
        // 想换位置只改 SLOT_MODE：
        //   "composer" 输入框 dock 行，与上下文计量器同排（默认，推荐）
        //   "header"   会话标题栏右侧的 utilities 区（最"角落"）
        //   "zone"     旧的输入框上方那一列（不推荐，会与任务列表同列）
        // 三种槽位都由官方客户端在加载时声明；未声明的槽位不会报错，只是不渲染。
        // ────────────────────────────────────────────────────────────────────
        var SLOT_MODES = {
          composer: "conversation.composer.dock",
          header: "conversation.session.header.utilities",
          zone: "conversation.input.dock"
        };
        var SLOT_MODE = "composer";
        var SLOT_NAME = SLOT_MODES[SLOT_MODE] || SLOT_MODES.composer;
        var SLOT_ID = "armor5";
        var SLOT_ORDER = 30;

        // 弹出方式（v0.48.0 起可切换）：同一个触发条，两种承载容器。
        //   popover —— 默认。锚在触发条上的原位浮层：一次量锚点，卡片贴着 chip 长。
        //              桌面/宽屏最好用；手机上键盘弹出或 dock 行位移后锚点会偏。
        //   drawer  —— 底部抽屉：视口锚定（不量锚点），内容分页（实时/命中/覆盖/档位）。
        //              手机上不会飘走，长内容靠页签分栏而不是把卡片撑高。
        // 两种容器共用同一批数据与同一个 section()，所以切布局不动数据面。
        // v0.49.0（C 方案）：LAYOUT_MODES / LAYOUT_MODE 已删 —— 容器不再有第二档，
        // 触发条单击或长按都直接唤起底部抽屉。DRAWER_TABS 仍用于抽屉分页。
        var DRAWER_TABS = [
          { id: "live", label: "实时" },
          { id: "hits", label: "命中" },
          { id: "fields", label: "明细" },
          { id: "todo", label: "任务" }
        ];

        var VERSION = "v0.66.0";
        var TITLE = "无限五代 " + VERSION;
        // 判决**不再自动淡出**：投影里的 verdict 一直有效，直到用户下一条发言
        // 才被重置成「执行中」。原先 3.2 秒后回落成空闲态，实际观感就是
        // 「命中提示一闪而过，还没看清就没了」。
        // 落笔时间由服务端投影给出（armor.at），所以刷新页面也还能看到最近判决。

        // 触发条形态（v0.8.1 起可切换；v0.8.0 及以前一律等价于 "full"）
        //   full    —— 常驻文字：空闲「无限五代」，判决「通过 · web(3) · 载荷 2」
        //   compact —— 短词：空闲/执行中只有一个圆点；判决只留状态词
        //              （通过/拒绝/兜底 + 领域短 id），数值全部收进浮层与 title
        //   glyph   —— 单字符（默认）：空闲/执行中只有一个圆点；判决只剩一个记号
        //              （✓ / ✕ / !，按 success/error 令牌着色），领域与数值全进浮层
        //   dot     —— 纯圆点：一切文字只在浮层与 title 里
        // 判决常驻、颜色仍走宿主 success/error 令牌 —— 亮着就说明它生效了。
        var TRIGGER_MODES = ["glyph", "compact", "full", "dot"];
        // === IG5-VISUAL-STATE-BEGIN ===
        // v0.52.5 起 / v0.52.8 修 · 运行时视觉状态机（纯函数，可在 Node 里单测）
        //   ig5NextEvent(prev, sig)  —— 投影读数 → **边沿触发**的事件（同一信号只触发一次）
        //   ig5VisualState(prev, ev, now) —— 事件 → 相位 / 闪烁次数 / 整场标记
        //   相位：blue（深蓝→浅蓝渐变呼吸）｜alert（红橙交替 ×3、每秒一次、3s 后回 blue）｜call（紫闪一次、0.9s 后回 blue）
        //   标记：整场无告警且至少注入一次 = ok（绿 ✓）；出过告警 = warn（橙 🟠）
        var IG5_VISUAL = { FLASHES: 3, FLASH_MS: 1000, CALL_MS: 900 };
        function ig5SignalKey(sig) {
          var s = sig || {};
          return [s.verdict || "", (s.words || []).join(","), (s.risk || []).join(","),
            // v0.65.12：载荷形态也进信号键 —— 形态出现/切换时给一次边沿事件，别让它静默上屏
            s.payloadShape || "", s.payloadHits || 0,
            s.skipped ? "1" : "", s.at || 0].join("|");
        }
        // v0.52.8 修：原先把 alert 当成「每拍重算」——判决常驻时每一帧都重启闪烁窗口，
        // 于是「没有再触发就恢复蓝色」永远不成立（红橙一直闪）。现在按信号键做边沿触发。
        function ig5NextEvent(prev, sig) {
          var s = sig || {};
          var key = ig5SignalKey(s);
          var bad = (s.words || []).length + (s.risk || []).length > 0 || !!s.skipped ||
            s.verdict === "fallback" || s.verdict === "refusal" || s.verdict === "empty";
          if (bad) return prev && prev.alertKey === key ? { type: "tick" } : { type: "alert", key: key };
          var calls = typeof s.toolCalls === "number" ? s.toolCalls : 0;
          if (calls > 0 && (!prev || prev.callKey !== String(calls))) return { type: "tool-call", key: String(calls) };
          if (s.verdict === "pass" && (!prev || prev.okKey !== key)) return { type: "inject-ok", key: key };
          return { type: "tick" };
        }
        function ig5VisualState(prev, ev, now) {
          var t = typeof now === "number" ? now : 0;
          var base = {
            phase: "blue", flashes: 0, startedAt: 0, ok: null, injected: 0,
            alerted: false, called: false, alertKey: null, callKey: null, okKey: null
          };
          var s = prev && typeof prev === "object"
            ? {
              phase: prev.phase || "blue",
              flashes: prev.flashes || 0,
              startedAt: prev.startedAt || 0,
              ok: prev.ok === undefined ? null : prev.ok,
              injected: prev.injected || 0,
              alerted: !!prev.alerted,
              called: !!prev.called,
              alertKey: prev.alertKey || null,
              callKey: prev.callKey || null,
              okKey: prev.okKey || null
            }
            : base;
          var type = ev && ev.type ? ev.type : "tick";
          if (type === "reset") {
            s = Object.assign({}, base);
          } else if (type === "inject-ok") {
            s.injected += 1;
            if (ev.key) s.okKey = ev.key;
          } else if (type === "alert") {
            s.alerted = true;
            s.ok = false;
            s.phase = "alert";
            s.flashes = 1;
            s.startedAt = t;
            if (ev.key) s.alertKey = ev.key;
          } else if (type === "tool-call") {
            s.called = true;
            if (ev.key) s.callKey = ev.key;
            if (s.phase !== "alert") {
              s.phase = "call";
              s.startedAt = t;
            }
          }
          if (s.startedAt > 0 && (s.phase === "alert" || s.phase === "call")) {
            var span = s.phase === "alert" ? IG5_VISUAL.FLASHES * IG5_VISUAL.FLASH_MS : IG5_VISUAL.CALL_MS;
            var age = t - s.startedAt;
            if (age >= span) {
              s.phase = "blue";
              s.startedAt = 0;
              s.flashes = 0;
            } else if (s.phase === "alert") {
              s.flashes = Math.min(IG5_VISUAL.FLASHES, Math.floor(age / IG5_VISUAL.FLASH_MS) + 1);
            }
          }
          if (s.ok === null && s.injected > 0 && !s.alerted) s.ok = true;
          s.mark = s.ok === true ? "ok" : s.ok === false ? "warn" : null;
          return s;
        }
        // === IG5-VISUAL-STATE-END ===
        if (typeof window !== "undefined") {
          window.__IG5_VISUAL_STATE__ = ig5VisualState;
          window.__IG5_VISUAL_NEXT__ = ig5NextEvent;
        }
        var TRIGGER_MODE = "glyph";

        // 判决的单字符代号。领域 id 是英文，跟状态词拼在一起读起来像句子
        // （「通过 injection」），单字符记号既最短又不产生误读；细节在浮层里。
        var VERDICT_GLYPHS = { pass: "✓", refusal: "✕", fallback: "!", empty: "…" };

        // 空闲态的常驻文字（只有 TRIGGER_MODE === "full" 才会上屏）。
        var IDLE_LABEL = "无限五代";

        // 同机若还装着上一代破甲插件，它的徽标也挂在输入框附近 —— 两条叠在一起。
        // 五代是接替者：只在自己拿到投影数据时才折叠对方（拿不到就保留对方的，
        // 避免两个都不显示）。
        var FOREIGN_BADGE = /^无限[三四]代/;

        // 样式全部走宿主自己的设计令牌（--dsw-* / --dsh-*），并逐个给出兜底色，
        // 这样外壳换主题时我们跟着变，而不是一块贴上去的死绿色。
        var STYLE_ID = "dsh-armor5-css";
        var STYLE_TEXT = [
          "@keyframes dshArmor5Pending{0%{opacity:.35}to{opacity:1}}",
          // 触发器：逐项对齐宿主 ContextMeter 的 .trigger —— 无边框、无底色、
          // tertiary 文字，hover / aria-expanded 才浮出 interactive-bg-hover。
          ".dsh-armor5-root{display:inline-flex;align-items:center;gap:6px;flex:none;",
          "padding:1px 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;",
          "color:var(--dsw-alias-label-tertiary,#8b8b8b);font-family:inherit;",
          "font-size:var(--dsh-content-font-size-secondary,13px);",
          "line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));",
          "font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer}",
          ".dsh-armor5-root:hover,.dsh-armor5-root[aria-expanded=true]{",
          "background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));",
          "color:var(--dsw-alias-label-secondary,#b4b4b4)}",
          ".dsh-armor5-root:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}",
          // 状态色只改 color，圆点用 currentColor 跟着走（同宿主 StateDot 的做法）。
          ".dsh-armor5-root[data-tone=success]{color:var(--dsw-alias-state-success-primary,#3fb950)}",
          ".dsh-armor5-root[data-tone=error]{color:var(--dsw-alias-state-error-primary,#f85149)}",
          ".dsh-armor5-dot{width:6px;height:6px;border-radius:50%;corner-shape:round;background:currentColor;flex:none}",
          // 运行中：逐项对齐宿主 InputBar 的 .pending 呼吸点（8px、business 色、1s 交替透明度）。
          ".dsh-armor5-dot[data-busy]{width:8px;height:8px;",
          "background:var(--dsw-alias-state-business-primary,#4d6bfe);",
          "animation:dshArmor5Pending 1s ease-in-out infinite alternate}",
          ".dsh-armor5-text{max-width:22ch;overflow:hidden;text-overflow:ellipsis}",
          // v0.51.11：用户模式下触发条的状态文字（空闲 / 执行中 / 通过…）收一档并限宽，
          // 不再让那串字跟正文一样大。dev 模式保留可读尺寸（开发者要看全）。
          // v0.51.13：状态词（通过 / 进行中）再小一档并允许收缩 —— flex 子项不给 min-width:0 就不会缩，
          // 字一长就顶出去（这就是「会溢出」的直接原因）。
          ".dsh-armor5-root[data-panel='user'] .dsh-armor5-text{font-size:10px;line-height:13px;max-width:12ch;min-width:0}",
          ".dsh-armor5-root{min-width:0}",
          ".dsh-armor5-root[data-panel='user']{max-width:100%}",
          ".dsh-armor5-root[data-panel='user']{gap:4px}",
          // v0.49.0（C 方案）：原位浮层 .dsh-armor5-panel 的规则已删除；下方 head/sec/hits 等为抽屉共用，保留。
          // 头部：判决徽标 + 标题 + 版本/时刻（右对齐）。徽标按 tone 上色，一眼分辨通过/拒绝/执行中。
          ".dsh-armor5-head{display:flex;align-items:center;gap:4px}",
          ".dsh-armor5-head b{color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:500}",
          // v0.51.15：抽屉头部的「挤占」治理 —— 这一行以前没有任何收缩约束（无 min-width:0、无 nowrap，
          // 右侧簇也没定宽），元素一多就互相顶。现在：页签区可收缩可横滚，右侧簇固定不缩，版本可截断。
          ".dsh-armor5-drawer .dsh-armor5-tabs{flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}",
          ".dsh-armor5-drawer .dsh-armor5-tabs::-webkit-scrollbar{display:none}",
          ".dsh-armor5-drawer .dsh-armor5-head-right{flex:0 0 auto;min-width:0;gap:3px;white-space:nowrap}",
          ".dsh-armor5-drawer .dsh-armor5-ver{flex:0 1 auto;min-width:0;max-width:64px;overflow:hidden;",
          "text-overflow:ellipsis;white-space:nowrap}",
          // 用户模式不显示版本号：它是开发者信息，占着这一行的位置还挤别人。
          ".dsh-armor5-drawer[data-panel='user'] .dsh-armor5-ver{display:none}",
          ".dsh-armor5-head-right{margin-left:auto;display:flex;align-items:center;gap:5px;",
          "color:var(--dsw-alias-label-caption,#8b8b8b);font-size:10px;font-variant-numeric:tabular-nums}",
          ".dsh-armor5-badge{display:inline-flex;align-items:center;height:15px;padding:0 6px;border-radius:999px;",
          "font-size:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}",
          ".dsh-armor5-badge[data-tone=running]{background:rgba(77,107,254,.16);",
          "color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
          ".dsh-armor5-badge[data-tone=success]{background:rgba(63,185,80,.16);",
          "color:var(--dsw-alias-state-success-primary,#3fb950)}",
          ".dsh-armor5-badge[data-tone=warning]{background:rgba(210,153,34,.16);",
          // v0.17.2：这里原本漏了一行闭合（只写了 background、没写 color 与右花括号），
          // 于是样式表从这条规则起「规则里套规则」—— 后面的 chip / tile / grid 全部变成
          // 只有 warning 徽标才生效的嵌套规则，卡片整块排版静默失效。自检加括号配平断言。
          "color:var(--dsw-alias-state-warning-primary,#d29922)}",
          ".dsh-armor5-badge[data-tone=error]{background:rgba(248,81,73,.16);",
          "color:var(--dsw-alias-state-error-primary,#f85149)}",
          // 分区：命中标记 / 风险载荷各自成块，用 chip 铺开 —— 长词表也比一行逗号好扫。
          ".dsh-armor5-sec{margin-top:6px;display:flex;flex-direction:column;gap:3px}",
          // 分区之间压一条发丝线：整张卡片原来是同权重的灰字墙，靠 1px 边线分组才扫得动。
          ".dsh-armor5-sec + .dsh-armor5-sec{margin-top:6px;padding-top:6px;",
          "border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}",
          ".dsh-armor5-sec-title{color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:10px;",
          "line-height:13px;letter-spacing:.02em}",
          // v0.22.0：浮层卡片里的「用户向选择」循环切档按钮（复用宿主色板，尺寸压到卡片字号）。
          ".dsh-armor5-cycle{align-self:flex-start;max-width:100%;padding:1px 7px;border:0;cursor:pointer;",
          "border-radius:999px;font-size:10.5px;line-height:15px;white-space:nowrap;overflow:hidden;",
          "text-overflow:ellipsis;background:rgba(77,107,254,.16);",
          "color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
          ".dsh-armor5-cycle:disabled{opacity:.5;cursor:default}",
          ".dsh-armor5-cycle[data-mode=off]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));",
          "color:var(--dsw-alias-label-caption,#8b8b8b)}",
          // 「位置」那一行改成 flex：左位置、右切档按钮；左边允许省略号，整行不换行（保住 v0.19.0 的高度预算）。
          ".dsh-armor5-caprow{display:flex;align-items:center;gap:6px}",
          ".dsh-armor5-caprow .dsh-armor5-cap{flex:1 1 auto;min-width:0;overflow:hidden;",
          "text-overflow:ellipsis;white-space:nowrap}",
          ".dsh-armor5-caprow .dsh-armor5-cycle{flex:0 0 auto;max-width:62%}",
          ".dsh-armor5-chips{display:flex;flex-wrap:wrap;gap:2px}",
          ".dsh-armor5-chip{display:inline-flex;align-items:center;max-width:100%;padding:0.5px 5px;border-radius:4px;",
          "font-size:10.5px;line-height:13px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));",
          "overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
          ".dsh-armor5-chip[data-kind=hit]{background:rgba(77,107,254,.14);",
          "color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
          ".dsh-armor5-chip[data-kind=risk]{background:rgba(248,81,73,.14);",
          "color:var(--dsw-alias-state-error-primary,#f85149)}",
          ".dsh-armor5-chip[data-kind=safe]{background:rgba(63,185,80,.14);",
          "color:var(--dsw-alias-state-success-primary,#3fb950)}",
          ".dsh-armor5-chip[data-kind=none]{padding:1px 0;background:0 0;color:var(--dsw-alias-label-caption,#8b8b8b)}",
          // v0.51.13：记忆区四种 kind 之前也没有配色规则（同样表现为「有数字没颜色」），这里补齐。
          ".dsh-armor5-chip[data-kind=mem-marker],.dsh-armor5-chip[data-kind=mem-domain]{background:rgba(77,107,254,.14);",
          "border:1px solid rgba(77,107,254,.32)}",
          ".dsh-armor5-chip[data-kind=mem-risk]{background:rgba(248,81,73,.14);border:1px solid rgba(248,81,73,.32)}",
          ".dsh-armor5-chip[data-kind=mem-safe]{background:rgba(63,185,80,.14);border:1px solid rgba(63,185,80,.32)}",
          // 最近命中流水：一条 = 时刻 · 判决 · 领域(命中数) · 载荷数，副行是那次的命中词。
          ".dsh-armor5-hits{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;",
          "max-height:120px;overflow:auto}",
          ".dsh-armor5-hits li{display:flex;flex-direction:column;gap:2px;padding:4px 6px;border-radius:6px;",
          "background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}",
          ".dsh-armor5-hit-main{font-size:10.5px;font-variant-numeric:tabular-nums}",
          ".dsh-armor5-hit-main[data-verdict=refusal]{color:var(--dsw-alias-state-error-primary,#f85149)}",
          ".dsh-armor5-hit-main[data-verdict=fallback]{color:var(--dsw-alias-state-warning-primary,#d29922)}",
          ".dsh-armor5-hit-main[data-verdict=empty]{color:var(--dsw-alias-text-tertiary,rgba(127,127,127,.85))}",
          // ── v0.53.2：命中行三段栅格（判决色点 / 时间 / 正文）──
          ".dsh-armor5-hits li{display:grid;grid-template-columns:6px 34px 1fr;align-items:center;column-gap:6px}",
          ".dsh-armor5-hits li[data-has-time='0']{grid-template-columns:6px 1fr}",
          ".dsh-armor5-hits li:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}",
          ".dsh-armor5-hit-dot{width:6px;height:6px;border-radius:50%;justify-self:center;",
          "background:var(--dsw-alias-state-success-primary,#3aa76d)}",
          ".dsh-armor5-hit-dot[data-verdict=refusal]{background:var(--dsw-alias-state-error-primary,#f85149)}",
          ".dsh-armor5-hit-dot[data-verdict=fallback]{background:var(--dsw-alias-state-warning-primary,#d29922)}",
          ".dsh-armor5-hit-dot[data-verdict=empty]{background:var(--dsw-alias-label-tertiary,#8b8b8b)}",
          ".dsh-armor5-hit-time{font-size:10px;line-height:12px;text-align:right;",
          "color:var(--dsw-alias-label-tertiary,#8b8b8b);font-variant-numeric:tabular-nums}",
          ".dsh-armor5-hit-body{min-width:0;display:flex;flex-direction:column;gap:1px}",
          ".dsh-armor5-hit-main{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
          ".dsh-armor5-hit-sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
          ".dsh-armor5-hit-sub{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:10px;overflow-wrap:anywhere}",
          // IG5-PANEL-STREAM C1：实时流 —— 新到的那一条闪一下并上移半像素，让「刚长出来」看得见。
          // IG5-PANEL-STREAM-MERGE M1：实时流不再单开一个列表（与「最近命中」是同一批行），
          // 新到的那条并入同一个列表的第一行，闪一下并上移半像素，让「刚长出来」看得见。
          ".dsh-armor5-hits li{position:relative}",
          ".dsh-armor5-hits li[data-fresh='1']{animation:dsh-armor5-flash 1.6s ease-out}",
          "@keyframes dsh-armor5-flash{0%{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.22));",
          "transform:translateY(-2px)}100%{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));transform:none}}",
          // v0.52.5 · 运行时视觉四态（浮点渲染规则）：
          //   正常监测 = 深蓝→浅蓝渐变呼吸；拦截 / 异常注入 = 红橙交替 ×3（每秒一次）后自动回蓝；
          //   调用插件自身的工具 = 紫色单闪一次；整场判据 = 绿 ✓ / 橙 🟠。
          ".dsh-armor5-root[data-ig5-visual=blue]{animation:dshArmor5Breath 3.2s ease-in-out infinite}",
          "@keyframes dshArmor5Breath{0%,100%{color:#2f6fed;filter:brightness(.82)}50%{color:#7fb2ff;filter:brightness(1.28)}}",
          ".dsh-armor5-root[data-ig5-visual=alert]{animation:dshArmor5Alert 1s steps(1,end) 3}",
          "@keyframes dshArmor5Alert{0%{color:#f85149;background:rgba(248,81,73,.20)}50%{color:#d29922;background:rgba(210,153,34,.20)}100%{color:#f85149;background:rgba(248,81,73,.20)}}",
          ".dsh-armor5-root[data-ig5-visual=call]{animation:dshArmor5Call .9s ease-out 1}",
          "@keyframes dshArmor5Call{0%{color:#a371f7;transform:scale(1.16)}100%{color:inherit;transform:none}}",
          // v0.52.8：浮点只留一个符号 —— 不再加边框/环形描边，也不再追加字符。
          // 整场判决改由那个符号本身表达：有字形时染字形颜色，无字形时圆点直接变成 ✓ / 🟠。
          ".dsh-armor5-root[data-ig5-mark=ok]{color:var(--dsw-alias-state-success-primary,#3fb950)}",
          ".dsh-armor5-root[data-ig5-mark=warn]{color:var(--dsw-alias-state-warning-primary,#d29922)}",
          ".dsh-armor5-root[data-ig5-float='1']{background:transparent;border:0;box-shadow:none;padding:0;min-height:0}",
          ".dsh-armor5-dot[data-mark=ok]{width:auto;height:auto;background:transparent;border-radius:0;",
          "font-size:12px;line-height:1;color:var(--dsw-alias-state-success-primary,#3fb950)}",
          ".dsh-armor5-dot[data-mark=ok]::before{content:'✓'}",
          ".dsh-armor5-dot[data-mark=warn]{width:auto;height:auto;background:transparent;border-radius:0;",
          "font-size:11px;line-height:1;color:var(--dsw-alias-state-warning-primary,#d29922)}",
          ".dsh-armor5-dot[data-mark=warn]::before{content:'🟠'}",
          // v0.16.5：字段铺成「田字格」—— 最窄 286px 的卡片里，竖排一行一字段会连成一堵灰字墙；
          // 两列 tile（上标签、下值）让同一屏的信息量翻倍，视线的落点也从「找行」变成「数格子」。
          ".dsh-armor5-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}",
          ".dsh-armor5-tile{display:flex;flex-direction:column;gap:2px;min-width:0;padding:5px 6px;",
          "border-radius:7px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}",
          // 词表（命中 / 风险载荷）与长值独占一行：chip 换行时不会被挤进半个格子。
          ".dsh-armor5-tile[data-span='2']{grid-column:1/-1}",
          ".dsh-armor5-tile .t{color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:10px;line-height:12px;",
          "letter-spacing:.02em}",
          ".dsh-armor5-tile .b{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:10.5px;line-height:13px;",
          "overflow-wrap:anywhere;font-variant-numeric:tabular-nums}",
          ".dsh-armor5-tile .b[data-dim='1']{color:var(--dsw-alias-label-caption,#8b8b8b)}",
          // 工具名这类长英文串不换行（换行会把一个词劈成两半），溢出让省略号接管，全文进 title。
          ".dsh-armor5-tile .b[data-nowrap='1']{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
          // 头部下面那行技术注脚：只放「位置」，不占格子。
          ".dsh-armor5-cap{margin-top:5px;color:var(--dsw-alias-label-caption,#8b8b8b);font-size:10px;",
          "line-height:12px;overflow-wrap:anywhere}",
          // ── 设置台（settings.section 里的那一页） ──
          // 令牌全部取自设置页自己用的那一套（bg-layer-2 / border-l2 / label-* / business-primary），
          // 每个都带兜底色。比例按设置页的节奏调：可选块用两/三列网格，预览块是一块内嵌面板，
          // 只读块两栏对齐，按钮统一 30px 高。
          ".armor5-console{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;min-width:0;max-width:560px;padding:2px 0 18px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,12px);line-height:18px}",
          ".armor5-console-head{padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-2));box-shadow:0 10px 28px rgba(0,0,0,.08)}",
          ".armor5-console-head .armor5-console-title{gap:8px}",
          ".armor5-console-head .armor5-console-title b{font-size:16px;letter-spacing:-.01em}",
          ".armor5-console-head .armor5-console-hint{font-size:11px;margin-top:3px}",
          ".armor5-console-title::before{content:'✦';display:inline-grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-size:13px}",
          ".armor5-console-head{display:flex;flex-direction:column;gap:2px}",
          ".armor5-console>.armor5-console-group{padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}",
          ".armor5-console>.armor5-console-group:nth-of-type(2){background:linear-gradient(180deg,var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-2))}",
          ".armor5-console>.armor5-console-group .armor5-console-group-title{font-size:12px;letter-spacing:.01em}",
          ".armor5-console>.armor5-console-foot{padding:2px 2px 0}",
          ".armor5-console .armor5-console-btn{min-height:32px;height:auto;padding:7px 12px;border-radius:9px;font-weight:500}",
          ".armor5-console .armor5-console-btn.is-primary{box-shadow:0 4px 12px rgba(77,107,254,.22)}",
          ".armor5-console-title{display:flex;align-items:center;gap:6px}",
          ".armor5-console-title b{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13.5px;font-weight:600}",
          ".armor5-console-ver{display:inline-flex;align-items:center;height:15px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:10.5px;font-variant-numeric:tabular-nums}",
          ".armor5-console-hint{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:11px}",
          ".armor5-console-group{display:flex;flex-direction:column;gap:6px}",
          ".armor5-console-group-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:11.5px;font-weight:600}",
          ".armor5-console-choices{display:grid;gap:6px}",
          ".armor5-console-choices-2{grid-template-columns:repeat(2,minmax(0,1fr))}",
          ".armor5-console-choices-3{grid-template-columns:repeat(3,minmax(0,1fr))}",
          ".armor5-console-choices-1{grid-template-columns:minmax(0,1fr)}",
          ".armor5-console-choice{display:flex;flex-direction:column;gap:2px;align-items:flex-start;text-align:left;min-height:38px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:var(--dsw-radius-lg,10px);background:0 0;color:inherit;font:inherit;cursor:pointer;transition:background-color .12s ease,border-color .12s ease}",
          ".armor5-console-choice:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}",
          ".armor5-console-choice:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}",
          ".armor5-console-choice.is-active{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);",
          "background:var(--dsw-alias-interactive-bg-hover-accent,rgba(77,107,254,.10))}",
          ".armor5-console-choice-label{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px}",
          ".armor5-console-choice-hint{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:10.5px;line-height:14px}",
          ".armor5-console-previews{display:flex;flex-direction:column;gap:1px;padding:5px 7px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.20));border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}",
          ".armor5-console-preview{display:flex;align-items:center;gap:8px;height:22px}",
          ".armor5-console-preview-tag{flex:none;width:36px;color:var(--dsw-alias-label-caption,#8b8b8b);font-size:10.5px}",
          ".armor5-console-dock{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;min-width:0;padding:2px 4px 2px 0}",
          ".armor5-console-meter{color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:11px;font-variant-numeric:tabular-nums}",
          ".armor5-console-badge{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:11px}",
          ".armor5-console-badge[data-kind=pass]{color:var(--dsw-alias-state-success-primary,#3fb950)}",
          ".armor5-console-rows,.armor5-live-rows{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}",
          // v0.36.3：旋钮分三组后每组两栏 —— 12 个键一列到底会把设置页拉成长卷。
          // v0.36.4：两栏只在宽屏成立；手机（<560px）改单栏，否则来源标记与档位按钮会被挤到换行。
          ".armor5-knob-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",
          "@media (max-width:560px){.armor5-knob-grid{grid-template-columns:minmax(0,1fr)}}",
          ".armor5-knob{display:flex;flex-direction:column;gap:3px;min-width:0}",
          ".armor5-knob-head{display:flex;align-items:center;justify-content:space-between;gap:4px;min-width:0}",
          ".armor5-knob-name{flex:1 1 auto;min-width:0;font-size:11.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
          // 来源标记是 flex 项：不给 flex:0 0 auto + nowrap，中文会在 13px 高的胶囊里折成两行溢出来。
          ".armor5-knob-head .armor5-console-tag{flex:0 0 auto;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:13px}",
          ".armor5-knob .armor5-console-choices{grid-template-columns:1fr 1fr;gap:4px}",
          ".armor5-knob .armor5-console-choice{min-height:26px;padding:2px 6px}",
          ".armor5-knob .armor5-console-choice-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
          ".armor5-knob .armor5-console-choice-hint{display:none}",
          ".armor5-console-rows li,.armor5-live-rows li{display:grid;grid-template-columns:62px minmax(0,1fr);gap:8px;align-items:baseline}",
          ".armor5-console-rows .k,.armor5-live-rows .k{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:11px}",
          ".armor5-console-rows .v,.armor5-live-rows .v{color:var(--dsw-alias-label-secondary,#b4b4b4);font-size:11px;overflow-wrap:anywhere}",
          // v0.52.7：设置台的任务清单块与它的进度条样式一并删除 —— 任务显示只有一个归属：浮层抽屉。
          // 领域覆盖 · 词表 · 预算（v0.14.1）：族条形 + 预算进度条。条形颜色按占比分档，
          // 75% 起转黄、90% 起转红 —— 预算见底是「该加预算或减词」的信号，得让人一眼看见。
          ".armor5-cov-rows{display:flex;flex-direction:column;gap:4px}",
          ".armor5-cov-row{display:grid;grid-template-columns:62px minmax(0,1fr) auto;gap:8px;align-items:center}",
          ".armor5-cov-row .k{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:11px}",
          ".armor5-cov-row .n{color:var(--dsw-alias-label-secondary,#b4b4b4);font-size:11px;font-variant-numeric:tabular-nums}",
          ".armor5-cov-bar{height:5px;border-radius:999px;background:var(--dsw-alias-fill-l2,rgba(127,127,127,.22));overflow:hidden}",
          ".armor5-cov-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#3fb950);transition:width .25s ease}",
          ".armor5-cov-bar[data-level=warn] .armor5-cov-bar-fill{background:var(--dsw-alias-state-warning-primary,#d29922)}",
          ".armor5-cov-bar[data-level=danger] .armor5-cov-bar-fill{background:#d05a5a}",
          ".armor5-console-foot{display:flex;gap:6px;padding-top:0}",
          ".armor5-console-btn{height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-secondary,#b4b4b4);font:inherit;font-size:11.5px;cursor:pointer;transition:background-color .12s ease,color .12s ease}",
          ".armor5-console-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));",
          "color:var(--dsw-alias-label-primary,#e6e6e6)}",
          ".armor5-console-btn.is-primary{border-color:transparent;",
          "background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}",
          ".armor5-console-btn.is-primary:hover{background:var(--dsw-alias-button-primary-hover,#3d5bee);",
          "color:var(--dsw-alias-label-primary-foreground,#fff)}",
          ".armor5-console-tag{display:inline-flex;align-items:center;height:13px;padding:0 5px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));color:var(--dsw-alias-label-caption,#8b8b8b);font-size:10px;font-weight:400;vertical-align:middle}",
          ".armor5-console-tag[data-source=ui]{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);",
          "color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
          ".armor5-console-choices-4{grid-template-columns:repeat(4,minmax(0,1fr))}",
          ".armor5-console-yaml{margin:0;padding:5px 7px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:6px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));color:var(--dsw-alias-label-secondary,#b4b4b4);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;line-height:15px;white-space:pre-wrap;overflow-wrap:anywhere}",
          // ── 底部抽屉（v0.48.0 · LAYOUT_MODE=drawer） ──
          // 视口锚定（不量触发条位置）：手机键盘弹出/滚动都不会让容器飘走。
          // 高度走 dvh，底部让出 safe-area；内容分页，所以卡片不会被长列表撑高。
          ".dsh-armor5-scrim{position:fixed;inset:0;z-index:1099;background:var(--dsw-alias-bg-mask,rgba(0,0,0,.32))}",
          ".dsh-armor5-drawer{position:fixed;left:0;right:0;bottom:0;width:100vw;max-width:100vw;z-index:1100;box-sizing:border-box;",
          "display:flex;flex-direction:column;max-height:62vh;padding-bottom:env(safe-area-inset-bottom,0);",
          "border-radius:14px 14px 0 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));",
          "background:var(--dsw-alias-bg-layer-2,#1c1c1f);box-shadow:0 -10px 30px rgba(0,0,0,.35)}",
          // 高度三段兜底（v0.49.0）：dvh 优先（移动端地址栏收缩时更准），其次 JS 量的 --ig5-vh，最后回到 62vh。
          ".dsh-armor5-drawer{max-height:calc(var(--ig5-vh,62vh) * 0.62)}",
          "@supports (height:1dvh){.dsh-armor5-drawer{max-height:62dvh}}",
          ".dsh-armor5-root[data-pressing='1'] .dsh-armor5-dot{transform:scale(1.5)}",
          ".dsh-armor5-todos{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}",
          ".dsh-armor5-todo{display:flex;gap:6px;align-items:flex-start;font-size:11px;line-height:15px}",
          ".dsh-armor5-todo-glyph{flex:0 0 auto;width:12px;color:var(--dsw-alias-label-caption,rgba(127,127,127,.9))}",
          ".dsh-armor5-todo-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}",
          ".dsh-armor5-todo[data-status=completed] .dsh-armor5-todo-glyph{color:var(--dsw-alias-state-success-primary,#3aa76d)}",
          ".dsh-armor5-todo[data-status=in_progress] .dsh-armor5-todo-glyph{color:var(--dsw-alias-state-business-primary,#3b82f6)}",
          ".dsh-armor5-todo[data-status=pending]{color:var(--dsw-alias-label-caption,rgba(127,127,127,.85))}",
          ".dsh-armor5-mem{display:flex;flex-direction:column;gap:6px}",
          // v0.51.2：用户模式下把设置台压紧（字号 / 行距 / 间距 / 圆角一起收），开发者模式保持原样。
          ".armor5-console[data-panel='user']{font-size:12px;line-height:17px}",
          ".armor5-console[data-panel='user'] .armor5-console-group{margin-top:6px}",
          ".armor5-console[data-panel='user'] .armor5-console-group-title{margin-bottom:4px;font-size:11px}",
          ".armor5-console[data-panel='user'] .armor5-console-choices{gap:4px}",
          ".armor5-console[data-panel='user'] .armor5-console-choices>button{padding:4px 8px;border-radius:8px;min-height:28px;font-size:12px;flex:1 1 0}",
          // v0.51.16：用户模式隐藏内核调参组（注入面 / 载荷与预算 / 节拍与门 / 运行时锚点节拍 / 判定源 / 形态与去重），
          // v0.51.16 / v0.52.7：用户模式隐藏内核调参组（注入面 / 载荷与预算 / 节拍与门 / 只读字段…），
          // 只留用户能懂的：面板显示多少 / 放在哪 / 说哪套话 / 预览；任务清单已完全交给浮层抽屉，设置页不再重复画。
          ".armor5-console[data-panel='user'] [data-dev-only='1']{display:none}",
          ".armor5-console[data-panel='user'] .armor5-console-group{position:relative;padding:8px 0 6px;",
          "border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18))}",
          ".armor5-console[data-panel='user'] .armor5-console-group:first-of-type{border-top:0;padding-top:2px}",
          ".armor5-console[data-panel='user']>.armor5-console-group{background:var(--dsw-alias-bg-layer-1)}",
          ".armor5-console[data-panel='user'] .armor5-console-group-title{font-weight:600;opacity:.9}",
          // v0.52.7：用户模式再精简一层 —— 每个选项下面那行 10.5px 小字（含英文取值名）整块隐藏，
          // 只留组标题 + 选项名；分组卡片化，把「一堵灰字墙」拆成可数的几块；面板收窄到 520px。
          ".armor5-console[data-panel='user'] .armor5-console-choice-hint{display:none}",
          ".armor5-console[data-panel='user'] .armor5-console-group{padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}",
          ".armor5-console[data-panel='user'] .armor5-console-group:first-of-type{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}",
          ".armor5-console[data-panel='user']{gap:8px;max-width:520px}",
          ".armor5-console-secret-input{flex:1 1 auto;min-width:0;min-height:28px;padding:4px 8px;border-radius:8px;",
          "border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:inherit;font:inherit;font-size:12px}",
          ".dsh-armor5-chiprow{display:flex;flex-wrap:wrap;gap:4px}",
          // v0.50.6：触屏热区 —— 1px 内边距在手机上点不准，给到 28px 最小高度。
          ".dsh-armor5-filter{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));",
          "background:transparent;color:inherit;font:inherit;font-size:12px;min-height:28px;",
          "padding:4px 12px;border-radius:999px;display:inline-flex;align-items:center}",
          ".dsh-armor5-hits-empty{display:block;padding:4px 0;font-size:11px;line-height:15px;opacity:.6}",
          ".dsh-armor5-filter[data-on='1']{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.22));border-color:transparent}",
          // v0.51.8：状态徽标与行为状态「再小一半」—— 抽屉头部里的判决徽标（通过/拒答）与
          // 进行态文案（执行中/空闲）统一收小：字号 11→9、内边距砍半、行高 15→12。
          ".dsh-armor5-drawer .dsh-armor5-head{font-size:9px;line-height:12px}",
          // v0.51.10：判决徽标（通过 / 拒答）用的是 .dsh-armor5-badge（不是 .chip）——
          // v0.51.8 那条规则打偏了，所以「通过」看着没变小。这里直接压 badge 本身。
          // v0.51.14：抽屉里的「通过 / 进行中」再砍一半字号，并统一按**小徽章**处理
          // （高度 10px、字号 7px、圆角胶囊、内边距 3px）—— 它是状态记号，不该跟正文抢字号。
          ".dsh-armor5-drawer .dsh-armor5-badge{height:10px;padding:0 3px;font-size:7px;line-height:10px}",
          ".dsh-armor5-drawer .dsh-armor5-head>span,.dsh-armor5-drawer .dsh-armor5-head>b{font-size:8px;line-height:10px}",
          ".dsh-armor5-drawer .dsh-armor5-head{gap:3px}",
          ".dsh-armor5-drawer .dsh-armor5-badge .dsh-armor5-dot{width:3px;height:3px}",
          ".dsh-armor5-drawer .dsh-armor5-head .dsh-armor5-chip{font-size:9px;line-height:12px;padding:0 5px}",
          ".dsh-armor5-drawer .dsh-armor5-chip{font-size:10px;line-height:14px;padding:1px 6px}",
          ".dsh-armor5-mem-reset{flex:0 0 auto;margin-right:6px;min-height:28px;padding:4px 10px;border-radius:999px;",
          "border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:inherit;",
          "font:inherit;font-size:12px;cursor:pointer}",
          ".dsh-armor5-panel-toggle{flex:0 0 auto;margin-right:6px;min-height:28px;min-width:48px;padding:4px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:inherit;font:inherit;font-size:12px}",
          ".dsh-armor5-tab-count{flex:0 0 auto;margin-left:4px;font-size:10px;font-variant-numeric:tabular-nums;opacity:.75}",
          ".dsh-armor5-root .dsh-armor5-dot{transition:transform .12s ease-out}",
          ".dsh-armor5-drawer-grip{flex:0 0 auto;display:flex;padding:6px 12px 2px}",
          ".dsh-armor5-drawer-grip i{display:block;width:32px;height:4px;margin:0 auto;border-radius:999px;",
          "background:var(--dsw-alias-border-l2,rgba(127,127,127,.4))}",
          // ── v0.53：按 DSH 原生插件面板语言重绘抽屉（抽屉与设置台合并成一张 sheet）──
          // 依据宿主 web 包里**实际在用**的设计令牌：--dsw-alias-* / --dsw-radius-* /
          // --dsw-elevation-prominent / --dsw-mask-blur / --dsh-scrollbar-thumb；每个都带兜底值。
          ".dsh-armor5-scrim{background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.36));backdrop-filter:blur(var(--dsw-mask-blur,2px))}",
          ".dsh-armor5-drawer{border-radius:var(--dsw-radius-panel,18px) var(--dsw-radius-panel,18px) 0 0;",
          "background:var(--dsw-alias-bg-layer-2,#1c1c1f);box-shadow:var(--dsw-elevation-prominent,0 -12px 36px rgba(0,0,0,.42));",
          "border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}",
          ".dsh-armor5-drawer-grip{padding:8px 12px 4px}",
          ".dsh-armor5-drawer-grip i{width:40px;height:4px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.45))}",
          ".dsh-armor5-sheet-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:0 12px 8px}",
          ".dsh-armor5-sheet-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
          "font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}",
          ".dsh-armor5-sheet-title small{margin-left:6px;font-size:10px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8b8b8b)}",
          ".dsh-armor5-seg{flex:0 0 auto;display:flex;gap:2px;margin:0 12px 8px;padding:2px;",
          "border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.10));",
          "border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));overflow-x:auto;scrollbar-width:none}",
          ".dsh-armor5-seg::-webkit-scrollbar{display:none}",
          ".dsh-armor5-seg button{flex:1 1 0;min-width:max-content;height:28px;padding:0 10px;border:0;",
          "border-radius:calc(var(--dsw-radius-md,10px) - 2px);background:transparent;",
          "color:var(--dsw-alias-label-secondary,#b8b8b8);font:inherit;font-size:11px}",
          ".dsh-armor5-seg button[data-on='1']{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22));",
          "color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}",
          ".dsh-armor5-seg button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}",
          ".dsh-armor5-seg .dsh-armor5-head-right{flex:0 0 auto;margin-left:auto;display:flex;align-items:center;gap:3px}",
          ".dsh-armor5-seg .dsh-armor5-ver{display:none}",
          ".dsh-armor5-card{display:flex;flex-direction:column;gap:6px;padding:10px;",
          "border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07));",
          "border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}",
          // ── v0.53.1：参数行（kv）渲染结构 ──────────────────────────────
          ".dsh-armor5-kvs{display:flex;flex-direction:column;border-radius:var(--dsw-radius-md,10px);overflow:hidden;",
          "background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}",
          ".dsh-armor5-kv{display:flex;align-items:baseline;gap:10px;padding:5px 9px;min-height:26px;box-sizing:border-box}",
          ".dsh-armor5-kv+.dsh-armor5-kv{border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.12))}",
          ".dsh-armor5-kv .k{flex:0 0 auto;max-width:52%;color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:11px;line-height:15px}",
          ".dsh-armor5-kv .v{flex:1 1 auto;min-width:0;text-align:right;overflow-wrap:anywhere;",
          "color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;line-height:16px}",
          ".dsh-armor5-kv[data-kind=num] .v{font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1}",
          ".dsh-armor5-kv[data-kind=long] .v{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
          ".dsh-armor5-kv[data-kind=empty] .v{color:var(--dsw-alias-label-caption,#8b8b8b);opacity:.7}",
          ".dsh-armor5-kv[data-kind=bool] .v{flex:0 0 auto;padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;",
          "background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.18))}",
          ".dsh-armor5-kv .v[data-state=on]{color:var(--dsw-alias-state-success-primary,#3aa76d)}",
          ".dsh-armor5-kv .v[data-state=off]{color:var(--dsw-alias-label-tertiary,#8b8b8b)}",
          ".dsh-armor5-kvs-empty{display:block;padding:8px 2px;color:var(--dsw-alias-label-caption,#8b8b8b);font-size:11px}",
          ".dsh-armor5-tile .b[data-kind=num]{font-variant-numeric:tabular-nums}",
          ".dsh-armor5-tile .b[data-kind=empty]{color:var(--dsw-alias-label-caption,#8b8b8b)}",
          // ── v0.53.3：明细页长值的二级展示（收起=单行省略，展开=换行全文）──
          ".dsh-armor5-fold{cursor:pointer;display:block;position:relative}",
          ".dsh-armor5-fold[data-open='0']{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:26px}",
          ".dsh-armor5-fold[data-open='1']{white-space:pre-wrap;overflow-wrap:anywhere;padding-right:26px}",
          ".dsh-armor5-fold-hint{position:absolute;right:0;top:0;font-size:9px;line-height:13px;",
          "color:var(--dsw-alias-label-tertiary,#8b8b8b);opacity:.8}",
          ".dsh-armor5-fold:hover .dsh-armor5-fold-hint{color:var(--dsw-alias-label-secondary,#b8b8b8);opacity:1}",
          ".dsh-armor5-fold:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:1px}",
          // ── v0.53.4：任务页占位骨架 / 命中页筛选与分组头 / 明细页分卡 ──
          ".dsh-armor5-todo-skel-wrap{display:flex;flex-direction:column;gap:6px}",
          ".dsh-armor5-todo-skel-note{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:11px;line-height:15px}",
          ".dsh-armor5-skel .dsh-armor5-todo-glyph{opacity:.45}",
          ".dsh-armor5-skel-bar{flex:1 1 auto;min-width:0;height:9px;border-radius:999px;",
          "background:linear-gradient(90deg,var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10)),",
          "var(--dsw-alias-bg-layer-3,rgba(127,127,127,.22)),var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10)));",
          "background-size:200% 100%;animation:dsh-armor5-skel 1.4s ease-in-out infinite}",
          ".dsh-armor5-skel-bar[data-w='70']{max-width:70%}",
          ".dsh-armor5-skel-bar[data-w='92']{max-width:92%}",
          "@keyframes dsh-armor5-skel{0%{background-position:0% 0}100%{background-position:-200% 0}}",
          "@media (prefers-reduced-motion: reduce){.dsh-armor5-skel-bar{animation:none}}",
          ".dsh-armor5-filters{display:flex;align-items:center;gap:6px;margin:2px 0 6px}",
          ".dsh-armor5-filters-label{flex:0 0 auto;color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:10px}",
          ".dsh-armor5-filter[data-count]{font-variant-numeric:tabular-nums}",
          ".dsh-armor5-hgroup{margin-top:6px}",
          ".dsh-armor5-hgroup-head{display:flex;align-items:center;gap:6px;padding:2px 0 4px;",
          "border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14))}",
          ".dsh-armor5-hgroup-title{flex:1 1 auto;color:var(--dsw-alias-label-secondary,#b8b8b8);font-size:11px;font-weight:600}",
          ".dsh-armor5-hgroup-count{flex:0 0 auto;padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;",
          "background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));color:var(--dsw-alias-label-tertiary,#8b8b8b);",
          "font-variant-numeric:tabular-nums}",
          ".dsh-armor5-field-cards{display:flex;flex-direction:column;gap:8px;margin-top:4px}",
          ".dsh-armor5-field-card{gap:8px}",
          // ── v0.53.5：命中页滚动排版（单栏连续滚动 / 粘性标题 / 底部计数）──
          ".dsh-armor5-hits-pane{display:flex;flex-direction:column;min-height:0;max-height:min(42vh,340px);overflow:auto;",
          "overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsh-scrollbar-thumb,rgba(127,127,127,.4)) transparent;",
          "mask-image:linear-gradient(180deg,transparent 0,#000 8px,#000 calc(100% - 12px),transparent 100%)}",
          ".dsh-armor5-hgroup .dsh-armor5-hits{max-height:none;overflow:visible}",
          ".dsh-armor5-hgroup-head{position:sticky;top:0;z-index:2;",
          "background:var(--dsw-alias-bg-layer-2,#1c1c1f);backdrop-filter:blur(var(--dsw-mask-blur,2px))}",
          ".dsh-armor5-hits-foot{display:flex;justify-content:space-between;gap:8px;align-items:baseline;",
          "margin-top:6px;color:var(--dsw-alias-label-caption,#8b8b8b);font-size:10px;font-variant-numeric:tabular-nums}",
          ".dsh-armor5-hits-foot-hint{opacity:.8}",
          // ── v0.53.6：明细页对齐命中页（单栏滚动 + 卡片标题粘顶 + 更显眼的展开标记）──
          ".dsh-armor5-fields-pane{max-height:min(42vh,340px);overflow:auto;overscroll-behavior:contain;",
          "scrollbar-width:thin;scrollbar-color:var(--dsh-scrollbar-thumb,rgba(127,127,127,.4)) transparent;",
          "mask-image:linear-gradient(180deg,transparent 0,#000 8px,#000 calc(100% - 12px),transparent 100%)}",
          ".dsh-armor5-field-card>.dsh-armor5-sec-title{position:sticky;top:-10px;z-index:1;",
          "background:var(--dsw-alias-bg-layer-2,#1c1c1f);padding:2px 0 4px}",
          ".dsh-armor5-fold[data-open='0'] .dsh-armor5-fold-hint{color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
          ".dsh-armor5-fold[data-open='0']{border-bottom:1px dotted var(--dsw-alias-border-l2,rgba(127,127,127,.35))}",
          // ── v0.53.7：内容包裹框（四页共用一层框，内容不再贴到抽屉边缘）──
          ".dsh-armor5-drawer-body{padding:6px 10px 10px}",
          ".dsh-armor5-frame{display:flex;flex-direction:column;min-height:0;padding:10px 10px 8px;",
          "border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:var(--dsw-radius-md,10px);",
          "background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}",
          ".dsh-armor5-frame>.dsh-armor5-drawer-pane{min-height:0}",
          ".dsh-armor5-frame .dsh-armor5-card{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10))}",
          // ── v0.53.8：命中列表包裹框（列表本身也有边/圆角/面层，行做成框上的小卡片）──
          ".dsh-armor5-hits-list{display:flex;flex-direction:column;gap:6px;padding:6px 8px;",
          "border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:var(--dsw-radius-md,10px);",
          "background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}",
          ".dsh-armor5-hits-list .dsh-armor5-hgroup:first-child{margin-top:0}",
          ".dsh-armor5-hits-list .dsh-armor5-hits li{border-radius:var(--dsw-radius-sm,8px)}",
          ".dsh-armor5-hits-list .dsh-armor5-hgroup-head{border-radius:var(--dsw-radius-sm,8px)}",
          // ── v0.53.9：明细页内层内容框 + 命中/明细的内容排版 ──
          // ── v0.53.12：明细页去掉那一层额外包裹（上半有框、下半没框 → 不再不对称）──
          ".dsh-armor5-fields-pane .dsh-armor5-field-card{padding:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10))}",
          ".dsh-armor5-fields-pane .dsh-armor5-field-card .dsh-armor5-sec-title{font-size:11.5px;letter-spacing:.2px}",
          ".dsh-armor5-fields-pane .dsh-armor5-tile .t{font-size:10px;letter-spacing:.1px}",
          ".dsh-armor5-fields-pane .dsh-armor5-tile .b{font-size:11px;line-height:15px}",
          // ── v0.53.13：「本对话累计」卡（框 + 排版，与上方两张卡同款）──
          ".dsh-armor5-mem-card{gap:8px;padding:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10))}",
          ".dsh-armor5-mem-card>.dsh-armor5-sec-title{font-size:11.5px;letter-spacing:.2px}",
          ".dsh-armor5-mem-card .dsh-armor5-mem{gap:8px}",
          ".dsh-armor5-mem-card .dsh-armor5-sec .dsh-armor5-sec-title{font-size:10.5px;",
          "color:var(--dsw-alias-label-tertiary,#8b8b8b);letter-spacing:.1px}",
          ".dsh-armor5-mem-card .dsh-armor5-chip{font-size:10.5px;padding:1px 6px;font-variant-numeric:tabular-nums}",
          ".dsh-armor5-mem-card .dsh-armor5-chips{gap:4px}",
          ".dsh-armor5-mem-empty{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:11px;line-height:15px}",
          // ── v0.56.0：身份卡（复用卡/chip/参数行规则，只补两处间距）──
          ".dsh-armor5-ident-card{gap:8px;padding:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10))}",
          ".dsh-armor5-ident-card>.dsh-armor5-sec-title{font-size:11.5px;letter-spacing:.2px}",
          ".dsh-armor5-ident-past{display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap}",
          ".dsh-armor5-ident-past-label{flex:0 0 auto;color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:10px;line-height:18px}",
          // ── v0.53.14：明细页底部让位（底部小面板不再挡住滚动内容），命中 / 任务两页不变 ──
          ".dsh-armor5-fields-pane{padding-bottom:104px;scroll-padding-bottom:104px}",
          // v0.53.15：命中页照同一条处理（底部小面板 + 渐隐同样会吃掉最后一行）；任务页保持原样。
          ".dsh-armor5-hits-pane{padding-bottom:104px;scroll-padding-bottom:104px}",
          ".dsh-armor5-hits-pane,.dsh-armor5-fields-pane{mask-image:none;-webkit-mask-image:none}",
          ".dsh-armor5-fields-foot{margin-top:6px;color:var(--dsw-alias-label-caption,#8b8b8b);font-size:10px;",
          "font-variant-numeric:tabular-nums;text-align:right;opacity:.9}",
          ".dsh-armor5-hits-list .dsh-armor5-hits{gap:4px}",
          ".dsh-armor5-hits-list .dsh-armor5-hit-main{font-weight:600;line-height:14px;letter-spacing:.1px}",
          ".dsh-armor5-hits-list .dsh-armor5-hit-sub{line-height:13px;opacity:.92}",
          // ── v0.53.11：任务页滚动容器（与命中/明细同一套手感）──
          ".dsh-armor5-todo-pane{max-height:min(52vh,420px);overflow:auto;overscroll-behavior:contain;",
          "scrollbar-width:thin;scrollbar-color:var(--dsh-scrollbar-thumb,rgba(127,127,127,.4)) transparent;",
          "mask-image:linear-gradient(180deg,transparent 0,#000 8px,#000 calc(100% - 12px),transparent 100%)}",
          ".dsh-armor5-todo-pane .dsh-armor5-sec:first-child{margin-top:0}",
          ".dsh-armor5-todo-pane .dsh-armor5-sec-title{position:sticky;top:0;z-index:1;",
          "background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));padding:2px 0 4px}",
          ".dsh-armor5-drawer-body{scrollbar-color:var(--dsh-scrollbar-thumb,rgba(127,127,127,.4)) transparent}",
          ".dsh-armor5-tabs{flex:0 0 auto;display:flex;align-items:center;gap:2px;padding:2px 10px 0;",
          "border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}",
          ".dsh-armor5-tabs button{flex:0 0 auto;height:28px;padding:0 10px;border:0;background:0 0;",
          "color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:11px;border-radius:6px 6px 0 0}",
          ".dsh-armor5-tabs button[data-on='1']{color:var(--dsw-alias-label-primary,#e6e6e6);",
          "box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary,#4d6bfe)}",
          ".dsh-armor5-drawer-body{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px 12px 12px}",
          ".dsh-armor5-drawer-body .dsh-armor5-sec{margin-top:0}",
          ".dsh-armor5-drawer-pane{display:flex;flex-direction:column;gap:6px}",
          ".dsh-armor5-tab-close{flex:0 0 auto;margin-left:auto;width:22px;height:22px;border:0;background:0 0;",
          "color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:12px;border-radius:6px}",
          ".dsh-armor5-tab-close:hover{background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.12))}",
          ".dsh-armor5-drawer-foot{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;",
          "gap:8px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));",
          "color:var(--dsw-alias-label-caption,#8b8b8b);font-size:10px;font-variant-numeric:tabular-nums}",
          // v0.65.17：设置页与浮层统一为同一套「工作台」视觉语言。
          ".armor5-console-choice{position:relative;min-height:48px;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);}",
          ".armor5-console-choice:hover{transform:translateY(-1px);border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-overlay)}",
          ".armor5-console-choice.is-active{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}",
          ".armor5-console-choice.is-active::after{content:'✓';position:absolute;top:8px;right:10px;color:var(--dsw-alias-brand-primary);font-weight:700}",
          ".armor5-console-previews{gap:5px;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-border-l1)}",
          ".armor5-console-preview{min-height:28px;padding:3px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}",
          ".armor5-console-preview:last-child{border-bottom:0}",
          ".armor5-console-foot{align-items:center;gap:8px;flex-wrap:wrap}",
          ".armor5-console-foot .armor5-console-btn{flex:1 1 140px}",
          ".dsh-armor5-drawer{border:1px solid var(--dsw-alias-border-l1);border-bottom:0;border-radius:22px 22px 0 0;background:var(--dsw-alias-bg-base);box-shadow:0 -18px 50px rgba(0,0,0,.18);overflow:hidden}",
          ".dsh-armor5-drawer-grip{background:var(--dsw-alias-bg-layer-1)}",
          ".dsh-armor5-drawer-grip i{width:44px;height:5px;background:var(--dsw-alias-border-l2);opacity:.8}",
          ".dsh-armor5-sheet-head{display:flex;align-items:center;padding:12px 16px 6px;background:linear-gradient(180deg,var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-base))}",
          ".dsh-armor5-sheet-title{font-size:16px;font-weight:650;letter-spacing:-.02em;color:var(--dsw-alias-label-primary)}",
          ".dsh-armor5-tabs{padding:4px 12px 0;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1)}",
          ".dsh-armor5-tabs button{height:34px;padding:0 13px;border-radius:9px 9px 0 0;font-weight:550}",
          ".dsh-armor5-tabs button[data-on='1']{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);box-shadow:inset 0 -2px 0 var(--dsw-alias-brand-primary)}",
          ".dsh-armor5-head-right{gap:6px;padding-left:8px}",
          ".dsh-armor5-badge{height:22px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px}",
          ".dsh-armor5-drawer-body{padding:14px 16px 18px;background:var(--dsw-alias-bg-base)}",
          ".dsh-armor5-drawer-pane{gap:10px}",
          ".dsh-armor5-sec{padding:12px 14px;margin-top:0;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}",
          ".dsh-armor5-sec + .dsh-armor5-sec{margin-top:0;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}",
          ".dsh-armor5-sec-title{font-size:11px;font-weight:650;letter-spacing:.02em;color:var(--dsw-alias-label-primary)}",
          ".dsh-armor5-chip{border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}",
          ".dsh-armor5-field-card,.dsh-armor5-mem-card,.dsh-armor5-ident-card{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)!important;box-shadow:none}",
          ".dsh-armor5-hits-list .dsh-armor5-hgroup,.dsh-armor5-hits-list .dsh-armor5-hits li{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}",
          // v0.65.18：命中页内部列表重绘——分组、条目、筛选与滚动反馈统一为可扫读的事件流。
          ".dsh-armor5-hits-pane{display:block;position:relative;isolation:isolate;min-height:96px;height:auto;max-height:min(58vh,520px);padding:0 2px 112px;scroll-padding:24px 0 112px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;background:var(--dsw-alias-bg-base);mask-image:none;-webkit-mask-image:none}",
          ".dsh-armor5-hits-list{display:block;position:relative;min-height:32px;visibility:visible;opacity:1;overflow:visible;padding:0 2px}",
          ".dsh-armor5-hits-list>.dsh-armor5-mem{display:flex;visibility:visible;opacity:1;flex-direction:column;gap:8px}",
          ".dsh-armor5-hits-pane,.dsh-armor5-hits-pane *{box-sizing:border-box}",
          ".dsh-armor5-hits-pane>.dsh-armor5-hits-list,.dsh-armor5-hits-pane>.dsh-armor5-hits-foot{position:relative;z-index:1}",
          ".dsh-armor5-hits-list .dsh-armor5-mem,.dsh-armor5-hits-list .dsh-armor5-sec,.dsh-armor5-hits-list .dsh-armor5-hgroup{visibility:visible;opacity:1;color:var(--dsw-alias-label-primary)}",
          ".dsh-armor5-hits-list .dsh-armor5-sec{display:flex;min-height:32px;overflow:visible}",
          ".dsh-armor5-hits-list .dsh-armor5-sec-title{display:block;visibility:visible;color:var(--dsw-alias-label-primary)}",
          ".dsh-armor5-hits-list>.dsh-armor5-mem{display:flex;flex-direction:column;gap:8px}",
          ".dsh-armor5-hits-list .dsh-armor5-hgroup{margin:0;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:visible}",
          ".dsh-armor5-hits-list .dsh-armor5-hgroup-head{display:flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border:0;border-radius:13px 13px 0 0;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1));box-shadow:none}",
          ".dsh-armor5-hits-list .dsh-armor5-hgroup-title{font-size:11px;font-weight:700;letter-spacing:.02em;color:var(--dsw-alias-label-primary)}",
          ".dsh-armor5-hits-list .dsh-armor5-hgroup-count{min-width:22px;padding:0 7px;text-align:center;line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}",
          ".dsh-armor5-hits-list .dsh-armor5-hits{gap:0;padding:4px 8px 8px}",
          ".dsh-armor5-hits-list .dsh-armor5-hits li{display:grid;grid-template-columns:8px 42px minmax(0,1fr);gap:9px;align-items:center;min-height:48px;padding:8px 7px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;background:transparent;transition:background-color .12s ease,transform .12s ease}",
          ".dsh-armor5-hits-list .dsh-armor5-hits li:last-child{border-bottom:0}",
          ".dsh-armor5-hits-list .dsh-armor5-hits li:hover{background:var(--dsw-alias-interactive-bg-hover);transform:translateX(2px)}",
          ".dsh-armor5-hits-list .dsh-armor5-hits li[data-fresh='1']{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}",
          ".dsh-armor5-hits-list .dsh-armor5-hit-dot{width:8px;height:8px;border-radius:50%;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 14%,transparent)}",
          ".dsh-armor5-hits-list .dsh-armor5-hit-time{align-self:start;padding-top:2px;color:var(--dsw-alias-label-caption);font-size:10px;font-variant-numeric:tabular-nums}",
          ".dsh-armor5-hits-list .dsh-armor5-hit-body{display:flex;min-width:0;flex-direction:column;gap:3px}",
          ".dsh-armor5-hits-list .dsh-armor5-hit-main{font-size:11.5px;line-height:16px;font-weight:650;letter-spacing:0;color:var(--dsw-alias-label-primary)}",
          ".dsh-armor5-hits-list .dsh-armor5-hit-sub{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-secondary);opacity:.9}",
          ".dsh-armor5-hits-list .dsh-armor5-hits-empty{display:block;padding:14px 10px;color:var(--dsw-alias-label-caption);font-size:11px;text-align:center}",
          ".dsh-armor5-hits-foot{position:sticky;bottom:0;z-index:3;margin:10px 2px 0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 94%,transparent);backdrop-filter:blur(8px);font-size:10px}",
          ".dsh-armor5-filters{position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:8px;margin:0 2px 10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 96%,transparent);backdrop-filter:blur(8px)}",
          ".dsh-armor5-filters-label{flex:0 0 auto;color:var(--dsw-alias-label-caption);font-size:10px;font-weight:650}",
          ".dsh-armor5-filters .dsh-armor5-chiprow{min-width:0;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none}",
          ".dsh-armor5-filters .dsh-armor5-chiprow::-webkit-scrollbar{display:none}",
          ".dsh-armor5-filters .dsh-armor5-chip{min-height:26px;padding:0 9px;color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}",
          ".dsh-armor5-filters .dsh-armor5-chip[data-on='1']{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-base))}",
          ".dsh-armor5-drawer-foot{padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}",
        ].join("");

        // ── 样式表保活（v0.65.7） ──
        // 这份 <style> 原来只由状态条那一次 useEffect 注入、卸载时 remove()。后端设置面板
        // （settings.section 的 ArmorConsolePage）是**独立挂载周期**：状态条没挂上（位置偏好
        // 指向未声明槽位）、或先于面板卸载（换槽位 / 宿主回收对话区）时，面板里的
        // .armor5-console-* 全部失配，整页退回浏览器默认样式 —— 这就是「面板丢 UI 包裹框」。
        // 现在谁用谁 ensure：**幂等注入、永不摘除**（惰性 CSS，留着无副作用），
        // 既不给面板绑上状态条的生命周期，也不在卸载路径上做任何可能抛错的全局变更。
        function ensureArmor5Style() {
          if (typeof document === "undefined" || !document || !document.head) return;
          try {
            if (!document.getElementById(STYLE_ID)) {
              var styleEl = document.createElement("style");
              styleEl.id = STYLE_ID;
              styleEl.textContent = STYLE_TEXT;
              document.head.appendChild(styleEl);
            }
          } catch (err) { /* 注入失败不该拖垮调用方的组件树 */ }
        }

        function sameNode(a, b) {
          return a === b;
        }

        function ArmorDock(props) {
          var useProjection = props.useProjection;
          // 形态来自设置台（默认值 = 源码常量），所以「设置里改了」与「状态条上显示」永远同源。
          // v0.48.0：一次读全（含 layoutMode），避免同一组件里再挂一条订阅。
          var dockPrefs = usePrefs();
          var triggerMode = dockPrefs.triggerMode;
          // 两个 useProjection 都是无条件调用，保持 hook 顺序恒定。
          // 五代用自己的投影键；"armor" 留给同机安装的四代（key: "armor"）。
          var canProject = typeof useProjection === "function";
          var armor5 = canProject ? useProjection("infinite-gen-5:armor") : undefined;
          var armor4 = canProject ? useProjection("armor") : undefined;
          // v0.50.2：把宿主「任务清单」投影读进来（宿主 dsh-client-ui-conversation 的
          // TodoDock 用的是同一个投影键 todos，形状 {content, status}[]，
          // status ∈ completed / in_progress / pending）。与其他两个一样无条件调用。
          var todos = canProject ? useProjection("todos") : undefined;
          // v0.50.5：命中页筛选（全部 / 通过 / 拒答）。三段共用同一枚筛选，避免各自翻。
          var hitFilterPair = react.useState("all");
          var hitFilter = hitFilterPair[0];
          var setHitFilter = hitFilterPair[1];
          var todoList = Array.isArray(todos) ? todos : [];
          var todoDone = 0;
          var todoActive = 0;
          for (var ti = 0; ti < todoList.length; ti++) {
            var todoRow = todoList[ti] || {};
            if (todoRow.status === "completed") todoDone += 1;
            else if (todoRow.status === "in_progress") todoActive += 1;
          }
          var todoPending = todoList.length - todoDone - todoActive;
          var todoSummary = [
            todoDone > 0 ? "完成 " + todoDone : "",
            todoActive > 0 ? "进行 " + todoActive : "",
            todoPending > 0 ? "待办 " + todoPending : ""
          ].filter(function (row) { return row !== ""; }).join(" · ");
          var armor = armor5 !== undefined ? armor5 : armor4;

          var rootRef = react.useRef(null);
          var openPair = react.useState(false);
          var open = openPair[0];
          var setOpen = openPair[1];
          var anchorPair = react.useState(null);
          var anchor = anchorPair[0];
          var setAnchor = anchorPair[1];
          // 抽屉页签（v0.48.0）：只在 drawer 布局下渲染，钩子在这里无条件声明，
          // 这样两种布局之间切换不会改变钩子顺序（React 的硬约束）。
          var drawerRef = react.useRef(null);
          // 抽屉几何修正：宿主注入点上方若有 transform / contain / filter 祖先，
          // position:fixed 会以那个祖先为包含块而不是视口 —— 表现就是「抽屉偏、右边盖不到」。
          // 这里量一次实测矩形，把位移补回来并把宽度铺满视口。
          var drawerBoxPair = react.useState(null);
          var drawerBox = drawerBoxPair[0];
          var setDrawerBox = drawerBoxPair[1];
          var drawerTabPair = react.useState("live");
          var drawerTab = drawerTabPair[0];
          var setDrawerTab = drawerTabPair[1];
          // v0.53.3：明细页长值的「展开/收起」状态（只存被展开的键，默认全收起）。
          var foldPair = react.useState({});
          var foldMap = foldPair[0];
          var setFoldMap = foldPair[1];
          var toggleFold = function (key) {
            var next = {};
            for (var k in foldMap) { if (Object.prototype.hasOwnProperty.call(foldMap, k) && k !== key) next[k] = 1; }
            if (!foldMap[key]) next[key] = 1;
            setFoldMap(next);
          };
          // 触发条的长按（v0.49.0 · C 方案）：单击与长按都唤起抽屉。
          // 长按给「一次直达」的手感，并在按住期间给视觉反馈；移动超过阈值判定为滚动，取消。
          var pressPair = react.useState(false);
          var pressing = pressPair[0];
          var setPressing = pressPair[1];
          var pressTimer = react.useRef(null);
          var longFired = react.useRef(false);
          var pressOrigin = react.useRef({ x: 0, y: 0 });
          var LONG_PRESS_MS = 420;
          var LONG_PRESS_SLOP = 10;
          var pressPoint = function (event) {
            var touch = event && event.touches && event.touches[0];
            return touch || event || null;
          };
          var pressStart = function (event) {
            var point = pressPoint(event);
            pressOrigin.current = { x: (point && point.clientX) || 0, y: (point && point.clientY) || 0 };
            setPressing(true);
            if (pressTimer.current) clearTimeout(pressTimer.current);
            pressTimer.current = setTimeout(function () {
              pressTimer.current = null;
              setPressing(false);
              longFired.current = true;
              setOpen(true);
            }, LONG_PRESS_MS);
          };
          var pressCancel = function () {
            setPressing(false);
            if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
          };
          var pressMove = function (event) {
            var point = pressPoint(event);
            if (!point) return;
            if (Math.abs(((point.clientX) || 0) - pressOrigin.current.x) > LONG_PRESS_SLOP ||
              Math.abs(((point.clientY) || 0) - pressOrigin.current.y) > LONG_PRESS_SLOP) pressCancel();
          };
          // 抽屉高度兜底（v0.49.0）：删掉浮层后抽屉是唯一容器，而 dvh 需要较新的内核；
          // 这里量一次视口写进 --ig5-vh，配合 CSS 三段落底，老内核上也不会无上限长高。
          react.useEffect(function () {
            if (typeof window === "undefined" || !window.document) return undefined;
            var doc = window.document;
            var sync = function () {
              try {
                doc.documentElement.style.setProperty("--ig5-vh", (window.innerHeight || 0) + "px");
              } catch (err) { /* 老内核 / 只读 documentElement：CSS 的 vh 兜底仍然生效 */ }
            };
            sync();
            if (typeof window.addEventListener !== "function") return undefined;
            window.addEventListener("resize", sync);
            window.addEventListener("orientationchange", sync);
            return function () {
              window.removeEventListener("resize", sync);
              window.removeEventListener("orientationchange", sync);
            };
          }, [open]);

          // 抽屉几何修正（同上）：只有开着时才量，量完把 dx/dy 与视口宽度写进 state。
          react.useEffect(function () {
            if (!open) return undefined;
            var node = drawerRef.current;
            if (!node || typeof node.getBoundingClientRect !== "function") return undefined;
            var win = (node.ownerDocument && node.ownerDocument.defaultView) || window;
            var measure = function () {
              var rect = node.getBoundingClientRect();
              var vw = win.innerWidth || 0;
              var vh = win.innerHeight || 0;
              if (!vw || !vh || !rect.width) return;
              var next = { width: vw, dx: -rect.left, dy: vh - rect.bottom };
              if (!drawerBox || drawerBox.width !== next.width ||
                Math.abs(drawerBox.dx - next.dx) > 0.5 || Math.abs(drawerBox.dy - next.dy) > 0.5) {
                setDrawerBox(next);
              }
            };
            measure();
            if (typeof win.addEventListener !== "function") return undefined;
            win.addEventListener("resize", measure);
            win.addEventListener("orientationchange", measure);
            return function () {
              win.removeEventListener("resize", measure);
              win.removeEventListener("orientationchange", measure);
            };
          }, [open, drawerTab]);
          // 浮层卡片里的「实时」四行（v0.16.1）：与设置页那组同源同文案，但只在卡片开着时
          // retain 统计库 —— 关着就不为它多开一条 SSE、多回读一次。
          var liveState = useStatsView(open);

          // 1) 样式表：确保在场（幂等；不随组件卸载摘除，见 ensureArmor5Style 上方说明）。
          react.useEffect(function () { ensureArmor5Style(); }, []);

          // 2) 折叠上一代徽标：先扫一次，只有真的扫到才挂 observer（常见情况零开销）。
          var foldable = armor !== undefined;
          react.useEffect(function () {
            if (!foldable) return undefined;
            var node = rootRef.current;
            if (!node || !node.ownerDocument) return undefined;
            var doc = node.ownerDocument;
            var folded = [];
            var lastFolded = -1;
            var scan = function () {
              var all = doc.querySelectorAll("[data-armor]");
              for (var i = 0; i < all.length; i++) {
                var n = all[i];
                if (sameNode(n, node)) continue;
                var t = n.getAttribute("title") || "";
                if (!FOREIGN_BADGE.test(t)) continue;
                if (n.style.display !== "none") {
                  n.style.display = "none";
                  n.setAttribute("data-armor-folded-by", "gen5");
                  folded.push(n);
                }
              }
              if (folded.length !== lastFolded) {
                lastFolded = folded.length;
                node.setAttribute(
                  "title",
                  folded.length > 0
                    ? TITLE + " · 已折叠上一代破甲徽标 x" + folded.length
                    : TITLE,
                );
              }
            };
            scan();
            var mo = null;
            if (folded.length > 0 && typeof MutationObserver === "function") {
              mo = new MutationObserver(scan);
              mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
            }
            return function () {
              if (mo) mo.disconnect();
              for (var i = 0; i < folded.length; i++) {
                folded[i].style.display = "";
                folded[i].removeAttribute("data-armor-folded-by");
              }
              folded.length = 0;
            };
          }, [foldable]);

          // 4) 浮层：打开时量一次锚点位置，并挂 outside-click / Esc。
          react.useEffect(function () {
            if (!open) return undefined;
            var node = rootRef.current;
            if (!node || typeof node.getBoundingClientRect !== "function") return undefined;
            var doc = node.ownerDocument;
            var win = doc.defaultView || window;
            var rect = node.getBoundingClientRect();
            var width = Math.min(264, win.innerWidth - 24);
            var left = rect.left + rect.width / 2 - width / 2;
            var maxLeft = win.innerWidth - width - 8;
            setAnchor({
              width: width,
              left: Math.max(8, Math.min(maxLeft, left)),
              bottom: win.innerHeight - rect.top + 6
            });
            var onDown = function (event) {
              var target = event.target;
              if (sameNode(target, node) || (node.contains && node.contains(target))) return;
              // C 方案（v0.49.0）：抽屉是唯一容器 —— ref 优先（真机 DOM 一定命中），
              // 类名查询兜底（v0.48.0 这里只查已删除的 .dsh-armor5-panel，导致抽屉内点击被误判为外部）。
              var hostNode = drawerRef.current;
              if (hostNode && hostNode.contains && hostNode.contains(target)) return;
              var hostQuery = doc.querySelector(".dsh-armor5-panel, .dsh-armor5-drawer");
              if (hostQuery && hostQuery.contains && hostQuery.contains(target)) return;
              setOpen(false);
            };
            var onKey = function (event) {
              if (event.key === "Escape") setOpen(false);
            };
            doc.addEventListener("pointerdown", onDown, true);
            doc.addEventListener("keydown", onKey, true);
            return function () {
              doc.removeEventListener("pointerdown", onDown, true);
              doc.removeEventListener("keydown", onKey, true);
            };
          }, [open]);

          // IG5-PANEL-STREAM C3a：库里那份实时流是服务端每个事件/每条判决都重写的，比投影 state 更勤；
          // 最新一条流判决若比投影新（多步任务里每一步都有一条），就先按它画田字格 —— 面板一步一长。
          var streamDoc = liveState && liveState.liveDoc ? liveState.liveDoc : null;
          var streamRaw = open && streamDoc && streamDoc.hits && Array.isArray(streamDoc.hits.stream)
            ? streamDoc.hits.stream : [];
          var streamNewest = streamRaw.length ? streamRaw[streamRaw.length - 1] : null;
          var streamNewestMs = streamNewest && streamNewest.at ? Date.parse(streamNewest.at) : 0;
          var streamArmorMs = armor && typeof armor.at === "number" && armor.at > 0 ? armor.at : 0;
          var streamFresh = streamNewestMs > 0 && (Date.now() - streamNewestMs) < 2500;
          if (streamNewest && streamNewestMs > streamArmorMs) {
            armor = Object.assign({}, armor, {
              verdict: streamNewest.verdict,
              emptyKind: streamNewest.emptyKind || null,
              domain: streamNewest.domain || null,
              domainLabel: streamNewest.domainLabel || null,
              domainHits: streamNewest.domainHits || 0,
              domainMarkers: Array.isArray(streamNewest.markers) ? streamNewest.markers : [],
              risk: Array.isArray(streamNewest.risk) ? streamNewest.risk : [],
              safe: Array.isArray(streamNewest.safe) ? streamNewest.safe : [],
              words: Array.isArray(streamNewest.words) ? streamNewest.words : [],
              openingChars: streamNewest.openingChars || 0,
              textChars: streamNewest.textChars || 0,
              at: streamNewestMs
            });
          }
          // IG5-PANEL-STREAM-MERGE M2：原先这里给「实时流」区块备料（另一个列表），已删 ——
          // 流的内容改由两处吃：最新一条填田字格（上面那段），其余并进「最近命中」（hitRows 内合并）。
          var running = !!(armor && armor.running);
          var verdict = armor && armor.verdict ? armor.verdict : null;
          // v0.65.12：结构性载荷形态（服务端投影识别）—— 面板据此显示「形态」记号与磁贴。
          var payloadShape = armor && armor.payloadShape ? armor.payloadShape : null;
          var payloadLabel = armor && armor.payloadLabel ? armor.payloadLabel : null;
          var payloadHits = armor && typeof armor.payloadHits === "number" ? armor.payloadHits : 0;
          var payloadConfidence = armor && armor.payloadConfidence ? armor.payloadConfidence : null;
          var payloadEvidence = armor && Array.isArray(armor.payloadEvidence) ? armor.payloadEvidence : [];
          var words = armor && Array.isArray(armor.words) ? armor.words : [];
          var risk = armor && Array.isArray(armor.risk) ? armor.risk : [];
          var safe = armor && Array.isArray(armor.safe) ? armor.safe : [];
          var domain = armor && armor.domain ? armor.domain : null;
          var domainLabel = armor && armor.domainLabel ? armor.domainLabel : null;
          var domainHits = armor && typeof armor.domainHits === "number" ? armor.domainHits : 0;
          var ranked = armor && Array.isArray(armor.domainRanked) ? armor.domainRanked : [];
          var domainMarkers = armor && Array.isArray(armor.domainMarkers) ? armor.domainMarkers : [];
          var textChars = armor && typeof armor.textChars === "number" ? armor.textChars : 0;
          var openingChars = armor && typeof armor.openingChars === "number" ? armor.openingChars : 0;
          var at = armor && typeof armor.at === "number" && armor.at > 0 ? armor.at : null;
          // v0.52.5 起 / v0.52.8 修：投影信号 → 状态机事件（边沿触发在 ig5NextEvent 里做）。
          //   异常词汇命中（words/risk）· 让位跳过 · 兜底 / 拒绝 / 空答 → alert（红橙交替 ×3）
          //   本插件自己的工具被调用（tools 环里出现 infinite_gen5_*） → tool-call（紫闪一次）
          //   其余每拍 tick；判决 pass 记一次注入成功（整场无 alert 即绿 ✓，出过 alert 就橙 🟠）
          var visualPrev = (typeof window !== "undefined" && window.__IG5_VISUAL_PREV__) || null;
          // v0.52.8：调用计数走 `armor.selfToolCalls`（服务端在判决投影里带的），
          // 旧字段 `armor.tools` 只作兜底 —— 之前只认它，而浮点订阅的投影里压根没有 tools，
          // 于是「调用插件自身的工具 → 紫闪」这条规则实际从未触发（本轮逻辑复查抓到的）。
          var ig5ToolCalls = 0;
          if (armor && typeof armor.selfToolCalls === "number") {
            ig5ToolCalls = armor.selfToolCalls;
          } else if (armor && Array.isArray(armor.tools)) {
            ig5ToolCalls = armor.tools.filter(function (x) {
              return String(x).indexOf("infinite_gen5_") === 0;
            }).length;
          }
          var ig5Ev = ig5NextEvent(visualPrev, {
            verdict: verdict,
            words: words,
            risk: risk,
            skipped: !!(armor && armor.skipped),
            at: at,
            toolCalls: ig5ToolCalls
          });
          var visual = ig5VisualState(visualPrev, ig5Ev, Date.now());
          if (typeof window !== "undefined") window.__IG5_VISUAL_PREV__ = visual;

          var tone = "quiet";
          var fullText = IDLE_LABEL;
          var shortText = "";
          var glyphText = "";
          var busy = false;
          if (running) {
            tone = "running";
            busy = true;
            fullText = "执行中";
          } else if (verdict !== null) {
            // 判决常驻：不设到期时间，下一条用户发言才会把它重置。
            // v0.17.0：empty = 空答 / 回显题面。它既不是交付也不是拒答，单独一档，
            // 免得面板把「答了个寂寞」显示成「通过」。
            var word = verdict === "fallback" ? "兜底"
              : verdict === "pass" ? "通过"
                : verdict === "empty" ? "空答" : "拒绝";
            tone = verdict === "pass" ? "success" : verdict === "empty" ? "warning" : "error";
            glyphText = VERDICT_GLYPHS[verdict] !== undefined ? VERDICT_GLYPHS[verdict] : word;
            if (verdict === "pass") {
              fullText = word +
                (domain ? " · " + domain + (domainHits > 1 ? "(" + domainHits + ")" : "") : "") +
                (risk.length ? " · 载荷 " + risk.length : "") +
                (payloadShape ? " · 形态 " + payloadShape : "");
              shortText = word +
                (domain ? " " + domain + (domainHits > 1 ? "(" + domainHits + ")" : "") : "") +
                (payloadShape ? " 形态" : "");
            } else {
              fullText = word + (words.length ? " · " + words[0] : "");
              shortText = word;
            }
          }
          // 上屏文字：glyph 用单字符（空闲/执行中无文字）、compact 用短词、full 用长文、
          // dot 一律无文字。文字以外的信息一律走 title（悬停）与浮层（点击）。
          var text = triggerMode === "full" ? fullText
            : triggerMode === "compact" ? shortText
              : triggerMode === "glyph" ? glyphText
                : "";
          // glyph 形态下判决有记号就不必再画圆点（圆点是空闲/执行中的形态）。
          var showDot = !(triggerMode === "glyph" && glyphText !== "");

          var candidatesText = ranked.length
            ? ranked.map(function (row) {
              return row.id + " " + row.hits + (row.id === domain ? "*" : "");
            }).join(" · ")
            : "—";
          // IG5-PANEL-TUNE P3：候选逐行明细（域 · 命中数 · 命中词）与空答细分，都来自同一份投影 state
          var rankedDetailText = ranked.length
            ? ranked.map(function (row) {
              return row.id + " " + row.hits
                + (row.markers && row.markers.length ? "（" + row.markers.slice(0, 3).join("、") + "）" : "");
            }).join(" · ")
            : "—";
          var emptyKind = armor && armor.emptyKind ? String(armor.emptyKind) : "";
          var clock = at === null ? "—" : clockOf(at);

          // 触发条被压缩成多态指示器后，细节靠 title（悬停）与浮层（点击）承载。
          var title = TITLE +
            (running ? " · 正在执行" : verdict !== null ? " · 最近判决 " + fullText : " · 空闲") +
            (armor === undefined ? " · 等待投影" : "") +
            " · 点击查看面板";

          // 卡片头部那颗徽标的文案：与状态条同一个口径，看一眼卡片就知道这一轮判成了什么。
          var badgeText = running ? "执行中"
            : armor === undefined ? "等待投影"
              : verdict === null ? "空闲"
                : verdict === "pass" ? "通过"
                  : verdict === "fallback" ? "兜底"
                    : verdict === "empty" ? "空答" : "拒绝";

          // v0.16.5：字段铺成「田字格」—— 一个字段一个 tile（上标签、下值），词表 tile 横跨两列；
          // 「位置」收成头部下面的一行注脚；「版本」行删掉（版本只在头部右侧出现一次，不再重复两遍）。
          var slotText = String(SLOT_NAME).replace(/^conversation\./, "");
          var tile = function (titleText, child, key, span) {
            return react.createElement("div",
              {
                className: "dsh-armor5-tile",
                key: key,
                "data-span": span === 2 ? "2" : undefined
              },
              react.createElement("span", { className: "t" }, titleText),
              child);
          };
          var textValue = function (value, nowrap, foldKey) {
            var kid = valueKind(value, nowrap);
            var raw = String(value == null ? "" : value);
            // v0.53.3：长值给「单行省略 + 点一下展开」，短值/空值保持纯文本。
            if (foldKey && kid === "long" && raw.length > 24) {
              var expanded = !!foldMap[foldKey];
              var toggle = function () { toggleFold(foldKey); };
              return react.createElement("span",
                {
                  className: "b dsh-armor5-fold",
                  "data-kind": kid,
                  "data-fold": "1",
                  "data-open": expanded ? "1" : "0",
                  role: "button",
                  tabIndex: 0,
                  title: expanded ? "点一下收起" : "点一下展开全文",
                  onClick: toggle,
                  onKeyDown: function (e) {
                    if (e && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(); }
                  }
                },
                raw,
                react.createElement("span", { className: "dsh-armor5-fold-hint", "aria-hidden": "true" },
                  expanded ? "收起 ▴" : "展开 ▾"));
            }
            return react.createElement("span",
              {
                className: "b",
                "data-dim": value === "—" || value === "无" ? "1" : undefined,
                "data-nowrap": nowrap ? "1" : undefined,
                "data-kind": kid,
                title: nowrap ? value : undefined
              }, value);
          };
          var tileGrid = function (items, key) {
            return react.createElement("div", { className: "dsh-armor5-grid", key: key }, items);
          };
          // ── v0.53.1：参数类内容专用渲染结构 ──────────────────────────────
          // 值先分型（num / bool / long / empty / text），再按型渲染：数字走等宽数字、
          // 布尔走胶囊、长值走省略号 + title、空值走暗色占位。
          var valueKind = function (value, nowrap) {
            var s = String(value == null ? "" : value);
            if (s === "" || s === "—" || s === "无") return "empty";
            if (/^-?\d+(\.\d+)?\s*(%|ms|s|字|条|项|次|个|KB|MB|B)?$/.test(s)) return "num";
            if (/^(是|否|开|关|true|false|on|off)$/i.test(s)) return "bool";
            if (nowrap || s.length > 24) return "long";
            return "text";
          };
          var kvRow = function (label, value, key, opts) {
            opts = opts || {};
            var kind = valueKind(value, opts.nowrap);
            var on = /^(是|开|true|on)$/i.test(String(value));
            return react.createElement("div", {
              className: "dsh-armor5-kv", key: key, "data-kind": kind,
              title: kind === "long" ? String(value) : undefined
            },
              react.createElement("span", { className: "k" }, label),
              react.createElement("span", {
                className: "v",
                "data-state": kind === "bool" ? (on ? "on" : "off") : undefined
              }, String(value)));
          };
          var kvList = function (pairs, key, opts) {
            var list = Array.isArray(pairs) ? pairs : [];
            if (!list.length) {
              return react.createElement("span", { className: "dsh-armor5-kvs-empty" },
                "本会话还没有参数读数（发一条消息后开始攒）");
            }
            return react.createElement("div", { className: "dsh-armor5-kvs", key: key },
              list.map(function (pair, index) {
                var long = opts && opts.longWhen ? opts.longWhen(pair[0]) : (String(pair[0]).indexOf("工具") >= 0);
                return kvRow(pair[0], pair[1], (key || "kv") + index, { nowrap: long });
              }));
          };
          var chipList = function (items, kind, emptyText) {
            return react.createElement("div", { className: "dsh-armor5-chips" },
              items.length
                ? items.map(function (item, index) {
                  return react.createElement("span",
                    { className: "dsh-armor5-chip", "data-kind": kind, key: index, title: item }, item);
                })
                : react.createElement("span", { className: "dsh-armor5-chip", "data-kind": "none" }, emptyText));
          };
          var section = function (titleText, child, key) {
            return react.createElement("div", { className: "dsh-armor5-sec", key: key },
              react.createElement("span", { className: "dsh-armor5-sec-title" }, titleText),
              child);
          };

          // v0.56.0：身份许可读数 —— 实时页一行「本步身份」，明细页一张「身份（本步 + 过往）」。
          // 数据来自 liveDoc.identity（服务端 identityState()），空态与命中态都有文案。
          var identityDoc = liveState.liveDoc && liveState.liveDoc.identity ? liveState.liveDoc.identity : null;
          var identityText = function (doc) {
            if (!doc || !doc.current) return "未命中（按通用口径）";
            return doc.current.label + " · 命中 " + doc.current.count + " 次"
              + (doc.alsoMatched && doc.alsoMatched.length ? " · 兼 " + doc.alsoMatched.join(" / ") : "");
          };
          var livePairs = open ? liveRowPairs(liveState.liveDoc, liveState.link, true) : [];
          if (open) livePairs = [["本步身份", identityText(identityDoc)]].concat(livePairs);
          // v0.53.1：实时页从「田字格」改为参数行（一条读数一行，右对齐、分型渲染）。
          var liveParams = kvList(livePairs, "live", {
            longWhen: function (label) {
              return String(label).indexOf("工具") >= 0 || String(label).indexOf("路径") >= 0;
            }
          });
          var hitList = open ? hitRows(liveState.liveDoc && liveState.liveDoc.hits) : [];
          // 明细页的「身份」卡：本步身份（参数行）+ 过往身份（chip 列表 + 次数），复用卡片与 chip 规则。
          var identityPastRows = (identityDoc && Array.isArray(identityDoc.seen) ? identityDoc.seen : [])
            .map(function (row) { return row.label + " ×" + row.count; });
          var identityCard = !open ? null : react.createElement("div",
            { className: "dsh-armor5-card dsh-armor5-ident-card" },
            react.createElement("div", { className: "dsh-armor5-sec-title" },
              "身份（本步 + 过往）"),
            kvList([
              ["本步身份", identityText(identityDoc)],
              ["默认域包", identityDoc && identityDoc.current && identityDoc.current.packs
                ? identityDoc.current.packs.join(" / ") : "—"],
              ["本会话身份命中", identityDoc && identityDoc.total
                ? String(identityDoc.total) + " 次 · " + identityPastRows.length + " 个口径" : "0 次"]
            ], "ident"),
            react.createElement("div", { className: "dsh-armor5-ident-past" },
              react.createElement("span", { className: "dsh-armor5-ident-past-label" }, "过往身份"),
              chipList(identityPastRows, "ident", "本会话还没有身份命中")));

          // v0.22.0：浮层卡片里直接切「用户向选择」档。复用同一个统计库订阅（卡片关着不连流、不回读），
          // 写入走 statsStore.stage + save —— 与设置页那条 POST 通道完全同源，不存在第二套写路径。
          var GATE_MODES = [
            { value: "proactive", label: "主动", hint: "任务输入 + 多步任务的每一步都给可点选择" },
            { value: "auto", label: "按节拍", hint: "每 ASK_GATE_EVERY 步才可能出现一次，最省" },
            { value: "on", label: "强制开", hint: "每步都可能出现；拿不到提问工具时降级成正文选项" },
            { value: "off", label: "关闭", hint: "锚点里永不出现询问与阶段条款" }
          ];
          var gateLive = (liveState.data && liveState.data.effective) || {};
          var gateDraft = liveState.draft || {};
          var gateMode = String(
            gateDraft.ASK_GATE_MODE !== undefined ? gateDraft.ASK_GATE_MODE
              : gateLive.ASK_GATE_MODE !== undefined ? gateLive.ASK_GATE_MODE : "proactive");
          var gateAt = 0;
          for (var gm = 0; gm < GATE_MODES.length; gm += 1) {
            if (GATE_MODES[gm].value === gateMode) gateAt = gm;
          }
          var gateNow = GATE_MODES[gateAt];
          var gateNext = GATE_MODES[(gateAt + 1) % GATE_MODES.length];
          var gateReady = liveState.phase === "ready";
          var gateCycle = function () {
            // 只写 ASK_GATE_MODE 这一个键。v0.22.0 初版把 effective 里每个键都 stage 一遍，结果点一下
            // 浮层按钮就把 profile config 的 RUNTIME_ANCHOR_EVERY=2 顺手提升成持久化 override（写进
            // ~/.dsh/infinite-gen-5-tuning.json），等于浮动按钮偷偷替用户改了别的档位。
            statsStore.stage("ASK_GATE_MODE", gateNext.value);
            statsStore.save(false);
          };
          // 只回一个按钮：它被并进「位置」那一行（v0.19.0 把卡片压到 353px，另起一节会把高度顶回 399px）。
          var gateButton = function () {
            return react.createElement("button", {
              type: "button",
              className: "dsh-armor5-cycle",
              "data-mode": gateMode,
              disabled: liveState.busy === true || !gateReady,
              title: "用户向选择（询问闸门）：当前「" + gateNow.label + "」—— " + gateNow.hint +
                "。点一下切到「" + gateNext.label + "」：" + gateNext.hint,
              onClick: gateCycle
            }, gateReady
              ? "选择：" + gateNow.label + " → " + gateNext.label
              : liveState.phase === "loading" ? "读取档位…" : "档位未就绪（刷新页面）");
          };

          // 判决明细磁贴：浮层与抽屉共用同一份（v0.48.0 起抽出为变量，避免两处各写一遍）。
          // v0.51.0：标签翻译的当前模式同步给模块级 L（dev 模式原样，用户模式查词表）。
          PANEL_LEX_STATE.dev = dockPrefs.panelMode === "dev";
          // v0.51.6：用户反馈「检测标签不是单个累计状态」—— 用户模式下这三个磁贴改成
          // 本对话累计（同一标识只占一格 + ×次数），dev 模式保留本条判决的原始词。
          var memEarly = liveState.liveDoc && liveState.liveDoc.hits
            && liveState.liveDoc.hits.groups && liveState.liveDoc.hits.groups.memory
            ? liveState.liveDoc.hits.groups.memory : null;
          var chipRowEarly = function (rows, kind) {
            var list = Array.isArray(rows) ? rows : [];
            if (!list.length) {
              return react.createElement("span", { className: "dsh-armor5-hits-empty" }, "本对话还没有累计");
            }
            return react.createElement("div", { className: "dsh-armor5-chiprow" },
              list.map(function (row) {
                return react.createElement("span", {
                  key: kind + row.name,
                  className: "dsh-armor5-chip",
                  "data-kind": kind,
                  title: row.name + " ×" + row.count
                }, row.name + " ×" + row.count);
              }));
          };
          // v0.51.12：修「明细页闪烁（有数字没颜色 / 有颜色没数字）」。
          // 根因：这一格以前有**两条互斥的渲染路径** —— 服务端累计到位就渲染 `名字 ×N`（mem-* 着色），
          // 累计还没到位就回落渲染原始词（hit/risk/safe 着色）；而累计是随着 SSE 回读一帧一阵到的，
          // 于是同一格在两套形状之间来回跳，看着就是闪。
          // 现在只留一条路径：**永远渲染 `名字 ×N`**（没有累计时按 ×1 兜底），着色固定走 mem-*，
          // dev 模式另当别论（开发者要原始词，不参与这条）。
          var accOrRaw = function (rawList, memKey, kind) {
            if (PANEL_LEX_STATE.dev) return chipList(rawList, kind, "无");
            var acc = memEarly && Array.isArray(memEarly[memKey]) ? memEarly[memKey] : null;
            var rows = (acc && acc.length)
              ? acc
              : (Array.isArray(rawList) ? rawList : []).map(function (name) {
                return { name: name, count: 1 };
              });
            // v0.51.13：着色用的是 `[data-kind=hit|risk|safe]`（mem-* 没有对应规则，所以上一版「有数字没颜色」）。
            // 磁贴这里固定用基础 kind，颜色与数字就同时在了。
            return chipRowEarly(rows, kind);
          };
          var tileLabel = function (key, rawList) {
            return PANEL_LEX_STATE.dev && rawList && rawList.length
              ? L(key) + " · " + rawList.length : L(key);
          };
          // v0.53.4：明细页按语义分两张卡。
          var fieldCard = function (titleText, child, key) {
            return react.createElement("div", { className: "dsh-armor5-card dsh-armor5-field-card", key: key },
              react.createElement("div", { className: "dsh-armor5-sec-title" }, titleText), child);
          };
          var clueTiles = tileGrid([
            tile(tileLabel("命中标记", domainMarkers),
              accOrRaw(domainMarkers, "markers", "hit"), "hit", 2),
            tile(tileLabel("风险载荷", risk),
              accOrRaw(risk, "risks", "risk"), "risk", 2),
            tile(tileLabel("安全标记", safe),
              accOrRaw(safe, "safe", "safe"), "safe", 1),
            tile("载荷形态",
              textValue(payloadShape
                ? payloadShape + "(" + payloadHits + ")" + (payloadConfidence ? " · " + payloadConfidence : "")
                : "—", false, "f-payload"), "payload", 1)
          ], "clues");
          var paramTiles = tileGrid([
            tile(L("识别领域"), textValue(domain ? (domainLabel || domain) : "—"), "domain", 1),
            tile(L("领域候选"), textValue(candidatesText, false, "f-cand"), "cand", 1),
            tile(L("拒答/兜底词"), textValue(words.length ? words.join("、") : "—", false, "f-words"), "words", 1),
            tile(L("扫描范围"), textValue(textChars
              ? "全文 " + textChars + " 字 · 判拒 " + openingChars + " 字"
              : "—", false, "f-range"), "range", 2),
            tile(L("候选明细"), textValue(rankedDetailText, false, "f-detail"), "cand", 2),
            tile(L("空答类型"), textValue(emptyKind || "—"), "empty", 1)
          ], "params");
          var fieldTiles = react.createElement("div", { className: "dsh-armor5-field-cards" },
            fieldCard("判定线索", clueTiles, "card-clues"),
            fieldCard("参数与范围", paramTiles, "card-params"));

          // v0.49.0（C 方案）：原位浮层容器已删除 —— 单击或长按触发条一律走下面的抽屉。
          // 回滚参照：本块原为「var panel = open && dockPrefs.layoutMode === "popover" ? … : null;」，
          // 完整原文见 panel-drawer-v0.48.0/DIFF.patch 与 git 历史（v0.48.0 = ee88dfe）。
          var panel = null;   // 占位：保留 overlay 的三元结构，避免下游引用炸掉；C 方案下 overlay 只取 drawer。

          // ── 抽屉容器（v0.48.0 · LAYOUT_MODE=drawer）────────────────────────
          // 与浮层同源：liveTiles / hitList / fieldTiles 三份数据原样搬进来，只换壳。
          // 页签只切「显示哪一页」，不改变任何订阅或回读时机。
          // v0.53.4：任务页在「无投影 / 投影为空」时预加载 4 条占位骨架。
          var todoSkeleton = function (reason) {
            return react.createElement("div", { className: "dsh-armor5-todo-skel-wrap", "data-skeleton": "4" },
              react.createElement("span", { className: "dsh-armor5-todo-skel-note" }, reason),
              react.createElement("ul", { className: "dsh-armor5-todos dsh-armor5-todos-skel" },
                [0, 1, 2, 3].map(function (i) {
                  return react.createElement("li", {
                    key: "skel" + i,
                    className: "dsh-armor5-todo dsh-armor5-skel",
                    "data-status": "pending",
                    "aria-hidden": "true"
                  },
                    react.createElement("span", { className: "dsh-armor5-todo-glyph" }, "○"),
                    react.createElement("span", {
                      className: "dsh-armor5-skel-bar",
                      "data-w": i % 2 ? "70" : "92"
                    }));
                })));
          };
          var todoPane = !canProject
            ? todoSkeleton("宿主未提供任务投影接口（useProjection 缺失）· 以下是 4 条占位")
            : todoList.length === 0
              ? todoSkeleton("本会话还没有任务清单（宿主 todos 投影为空）· 以下是 4 条占位")
              : section(todoSummary || "任务清单",
                react.createElement("ul", { className: "dsh-armor5-todos" },
                  todoList.map(function (item, index) {
                    var row = item || {};
                    var glyph = row.status === "completed" ? "✓"
                      : row.status === "in_progress" ? "●" : "○";
                    return react.createElement("li", {
                      key: "todo" + index,
                      className: "dsh-armor5-todo",
                      "data-status": row.status || "pending",
                      title: row.content
                    },
                      react.createElement("span", {
                        className: "dsh-armor5-todo-glyph",
                        "aria-hidden": "true"
                      }, glyph),
                      react.createElement("span", { className: "dsh-armor5-todo-text" },
                        row.content || ""));
                  })),
                "todo");

          var hitGroups = liveState.liveDoc && liveState.liveDoc.hits
            && liveState.liveDoc.hits.groups ? liveState.liveDoc.hits.groups : null;
          var filterHits = function (rows) {
            var list = Array.isArray(rows) ? rows : [];
            if (hitFilter === "all") return list;
            return list.filter(function (hit) { return (hit && hit.verdict) === hitFilter; });
          };
          var dayKey = function (value) {
            var t = typeof value === "string" ? Date.parse(value) : value;
            if (!isFinite(t)) return "更早";
            var d = new Date(t);
            return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
          };
          var bucketOf = function (value) {
            var now = new Date();
            if (dayKey(value) === dayKey(now.getTime())) return "今天";
            if (dayKey(value) === dayKey(now.getTime() - 86400000)) return "昨天";
            return "更早";
          };
          // v0.50.6：命中台账按天分组 —— 条数一多，光看「本对话/更早」分不清是什么时候的事。
          // v0.53.4：分组头独立成型（标题 + 条数胶囊 + 发丝线）。
          var hgroup = function (label, count, child, key) {
            return react.createElement("section", {
              className: "dsh-armor5-hgroup",
              key: key,
              "data-bucket": label
            },
              react.createElement("header", { className: "dsh-armor5-hgroup-head" },
                react.createElement("span", { className: "dsh-armor5-hgroup-title" }, label),
                react.createElement("span", { className: "dsh-armor5-hgroup-count" }, count)),
              child);
          };
          var hitTimeGroups = function (rows) {
            var buckets = { "今天": [], "昨天": [], "更早": [] };
            var list = Array.isArray(rows) ? rows : [];
            for (var index = 0; index < list.length; index += 1) {
              buckets[bucketOf(list[index] && list[index].at)].push(list[index]);
            }
            return ["今天", "昨天", "更早"].filter(function (label) {
              return buckets[label].length > 0;
            }).map(function (label) {
              return hgroup(label, buckets[label].length, hitRowsOf(buckets[label]), "hg-day-" + label);
            });
          };
          // v0.53.4：筛选条带计数。
          var hitCounts = { all: hitList.length, pass: 0, block: 0 };
          hitList.forEach(function (h) {
            if (!h) return;
            if (h.verdict === "pass") hitCounts.pass += 1;
            else if (h.verdict === "refusal" || h.verdict === "block") hitCounts.block += 1;
          });
          var hitFilterBar = react.createElement("div", { className: "dsh-armor5-filters" },
            react.createElement("span", { className: "dsh-armor5-filters-label" }, "筛选"),
            react.createElement("div", { className: "dsh-armor5-chiprow" },
              [["all", "全部"], ["pass", "通过"], ["block", "拒答"]].map(function (row) {
                return react.createElement("button", {
                  key: "hf" + row[0],
                  type: "button",
                  className: "dsh-armor5-chip dsh-armor5-filter",
                  "data-filter": row[0],
                  "data-count": hitCounts[row[0]] || 0,
                  "data-on": hitFilter === row[0] ? "1" : "0",
                  onClick: function () { setHitFilter(row[0]); }
                }, row[1] + " " + (hitCounts[row[0]] || 0));
              })));
          // v0.50.6：分组条目必须过既有归一化器 hitRows（raw 环条目只有 domain/markers，
          // 没有 main/sub，直接渲染会是一片空行）。喂成 {recent: [...]} 即复用同一条去重+倒序链。
          // v0.53.2：命中行同款化 —— 判决色点 + 时间列（等宽数字）+ 正文列（主行/副行各一行省略号）。
          // 时间列在有 at 时出现，没有 at 的行用 data-has-time="0" 让栅格少一列，不留空轨道。
          var hitTimeText = function (at) {
            var t = typeof at === "string" ? Date.parse(at) : at;
            if (!isFinite(t)) return "";
            var d = new Date(t);
            var pad = function (n) { return (n < 10 ? "0" : "") + n; };
            return pad(d.getHours()) + ":" + pad(d.getMinutes());
          };
          var hitRow = function (hit, key) {
            var time = hitTimeText(hit && hit.at);
            return react.createElement("li", {
              key: key,
              title: hit && hit.title,
              "data-fresh": hit && hit.fresh ? "1" : undefined,
              "data-has-time": time ? "1" : "0"
            },
              react.createElement("span", {
                className: "dsh-armor5-hit-dot",
                "data-verdict": hit && hit.verdict,
                "aria-hidden": "true"
              }),
              time ? react.createElement("span", { className: "dsh-armor5-hit-time" }, time) : null,
              react.createElement("span", { className: "dsh-armor5-hit-body" },
                react.createElement("span", {
                  className: "dsh-armor5-hit-main",
                  "data-verdict": hit && hit.verdict,
                  title: (hit && hit.main) || ""
                }, (hit && hit.main) || ""),
                react.createElement("span", { className: "dsh-armor5-hit-sub" },
                  V((hit && hit.sub) || ""))));
          };
          var hitRowsOf = function (rows) {
            var list = hitRows({ recent: filterHits(rows) });
            return list.length
              ? react.createElement("ul", { className: "dsh-armor5-hits" },
                list.map(function (hit, index) { return hitRow(hit, "hg" + index); }))
              : react.createElement("span", { className: "dsh-armor5-hits-empty" },
                hitFilter === "all" ? "这一类还没有判决" : "这一类里没有「" + hitFilter + "」的判决");
          };
          // v0.50.3：命中分三类（本对话 / 最近的更早对话 / 本进程全局累计）。
          // 老服务端不发布 groups 时，整段退回原来的单块「最近命中」，不空屏。
          var hitPaneGrouped = hitGroups
            ? react.createElement("div", { className: "dsh-armor5-mem" },
              hitFilterBar,
              section("本对话命中（" + filterHits(hitGroups.session).length + " 条 · 会话 "
                + (hitGroups.global && hitGroups.global.sessionId !== null
                  && hitGroups.global.sessionId !== undefined
                  ? String(hitGroups.global.sessionId).slice(0, 8) : "未知") + "）",
                react.createElement("div", { className: "dsh-armor5-mem" }, hitTimeGroups(hitGroups.session)), "hg-session"),
              section("最近对话命中（本进程更早 "
                + filterHits(hitGroups.earlier).length + " 条）",
                react.createElement("div", { className: "dsh-armor5-mem" }, hitTimeGroups(hitGroups.earlier)), "hg-earlier"),
              section("全局命中（本进程累计 "
                + ((hitGroups.global && hitGroups.global.total) || 0) + " 次判决）",
                react.createElement("div", { className: "dsh-armor5-hits" },
                  react.createElement("span", { className: "dsh-armor5-hit-sub" },
                    L("通过") + " " + ((hitGroups.global && hitGroups.global.pass) || 0)
                    + " · " + L("拒答") + " " + ((hitGroups.global && hitGroups.global.block) || 0)
                    + " · 命中域 " + (((hitGroups.global && hitGroups.global.byDomain) || [])
                      .join("、") || "—")),
                  react.createElement("span", { className: "dsh-armor5-hit-sub" },
                    hitGroups.global && hitGroups.global.lifetime
                      ? "跨重启累计 " + hitGroups.global.lifetime.total + " 次（" + L("通过") + " "
                        + hitGroups.global.lifetime.pass + " / " + L("拒答") + " " + hitGroups.global.lifetime.block + "）"
                      : "跨重启累计：统计库还没积累（~/.dsh/infinite-gen-5-stats.json）")), "hg-global"))
            : null;

          // v0.50.4：本对话标识记忆（去重 + 次数）——明细页尾部追加，换会话由服务端清空。
          var mem = hitGroups && hitGroups.memory ? hitGroups.memory : null;
          var memChips = function (rows, kind) {
            var list = Array.isArray(rows) ? rows : [];
            if (list.length === 0) return null;
            return react.createElement("div", { className: "dsh-armor5-chiprow" },
              list.map(function (row) {
                return react.createElement("span", {
                  key: kind + row.name,
                  className: "dsh-armor5-chip",
                  "data-kind": kind,
                  title: row.name + " ×" + row.count
                }, row.name + " ×" + row.count);
              }));
          };
          // v0.53.13：「本对话累计」补上与上方两张卡同款的包裹框与排版。
          var memCardTitle = function (text) {
            return react.createElement("div", { className: "dsh-armor5-sec-title" }, text);
          };
          var memCounts = mem && mem.verdicts ? mem.verdicts : {};
          var memoryPane = !mem || mem.turns === 0
            ? react.createElement("div", { className: "dsh-armor5-card dsh-armor5-mem-card", "data-empty": "1" },
              memCardTitle("本对话累计"),
              react.createElement("span", { className: "dsh-armor5-mem-empty" },
                "还没有判决（累计从第一条判决开始）"))
            : react.createElement("div", { className: "dsh-armor5-card dsh-armor5-mem-card" },
              memCardTitle("本对话累计（" + mem.turns + " 次判决 · 通过 "
                + (memCounts.pass || 0) + " / 拒答 " + (memCounts.block || 0) + "）"),
              react.createElement("div", { className: "dsh-armor5-mem" },
                section(L("识别领域"), memChips(mem.domains, "mem-domain") || react.createElement("span", { className: "dsh-armor5-sec-title" }, "—"), "mem-d"),
                section("命中标记", memChips(mem.markers, "mem-marker") || react.createElement("span", { className: "dsh-armor5-sec-title" }, "—"), "mem-m"),
                section("安全标记", memChips(mem.safe, "mem-safe") || react.createElement("span", { className: "dsh-armor5-sec-title" }, "—"), "mem-s"),
                section("风险载荷", memChips(mem.risks, "mem-risk") || react.createElement("span", { className: "dsh-armor5-sec-title" }, "—"), "mem-r")));

          var hitListFiltered = filterHits(hitList);
          // v0.53.5：命中页滚动与排版 —— 单栏连续滚动 + 粘性日分组头 + 底部计数。
          var hitFlatPane = section(hitListFiltered.length
            ? "最近命中（本进程最近 " + hitListFiltered.length + " 次判决）" : "最近命中",
            hitListFiltered.length
            ? react.createElement("ul", { className: "dsh-armor5-hits" },
              hitListFiltered.map(function (hit) { return hitRow(hit, hit.key); }))
            : react.createElement("span", { className: "dsh-armor5-sec-title" },
              "还没有判决留档（重启 DSH 后开始攒）"), "hits");
          // v0.53.18：底部「还有 N 条」提示 —— 滚动时数出视口下沿之下还剩几条；滚到底变「已到底」。
          var scrollHintRefs = {};
          var scrollTickPair = react.useState(0);
          var scrollTick = scrollTickPair[0];
          var setScrollTick = scrollTickPair[1];
          var scrollHint = function (kind, itemSel) {
            if (!scrollTick && scrollTick !== 0) return null;
            var box = scrollHintRefs[kind];
            if (!box || typeof box.scrollTop !== "number" || typeof box.clientHeight !== "number") return null;
            try {
              var nodes = box.querySelectorAll ? box.querySelectorAll(itemSel) : [];
              var bottom = box.scrollTop + box.clientHeight;
              var rest = 0;
              for (var i = 0; i < nodes.length; i += 1) {
                var it = nodes[i];
                if ((it.offsetTop || 0) + (it.offsetHeight || 0) > bottom + 1) rest += 1;
              }
              var end = box.scrollTop + box.clientHeight >= (box.scrollHeight || 0) - 2;
              return end ? "已到底" : "还有 " + rest + " 条 ↓ 继续下滑";
            } catch (e) { return null; }
          };
          var paneRef = function (kind) {
            return function (el) { scrollHintRefs[kind] = el || null; };
          };
          var paneScroll = function () { setScrollTick(function (t) { return t + 1; }); };

          var hitsPaneWrap = function (body) {
            return react.createElement("div", {
              className: "dsh-armor5-hits-pane",
              "data-count": hitCounts.all,
              "data-grouped": hitPaneGrouped ? "1" : "0",
              ref: paneRef("hits"),
              onScroll: paneScroll
            },
              react.createElement("div", { className: "dsh-armor5-hits-list" }, body),
              react.createElement("div", { className: "dsh-armor5-hits-foot" },
                react.createElement("span", null, "共 " + hitCounts.all + " 条留档"),
                react.createElement("span", { className: "dsh-armor5-hits-foot-hint" },
                  scrollHint("hits", ".dsh-armor5-hits li")
                    || "在本页内连续滚动 · 按 今天 / 昨天 / 更早 分组")));
          };
          var hitPane = hitsPaneWrap(hitPaneGrouped || hitFlatPane);
          // v0.53.11：任务页给独立滚动容器（与命中/明细同一套滚动手感）。
          var todoScroll = react.createElement("div", { className: "dsh-armor5-todo-pane" }, todoPane);
          var drawerPane = drawerTab === "hits"
            ? hitPane
            : drawerTab === "fields"
              ? react.createElement("div", {
                className: "dsh-armor5-drawer-pane dsh-armor5-fields-pane dsh-armor5-drawer-pane-flat",
                ref: paneRef("fields"),
                onScroll: paneScroll
              },
                fieldTiles, identityCard, memoryPane,
                react.createElement("div", { className: "dsh-armor5-fields-foot" },
                  scrollHint("fields", ".dsh-armor5-field-card") || "在本页内连续滚动"))
              : drawerTab === "todo"
                ? todoScroll
                : liveParams;

          var drawer = open
            ? react.createElement(
              react.Fragment,
              null,
              react.createElement("div", {
                className: "dsh-armor5-scrim",
                onClick: function () { setOpen(false); }
              }),
              react.createElement(
                "div",
                {
                  className: "dsh-armor5-drawer",
                  ref: drawerRef,
                  role: "dialog",
                  "aria-modal": "true",
                  "data-tone": tone,
                  "data-tab": drawerTab,
                  "data-panel": dockPrefs.panelMode === "dev" ? "dev" : "user",
                  style: drawerBox
                    ? {
                      left: 0,
                      right: "auto",
                      bottom: 0,
                      // 宽度用 CSS 视口单位，不依赖 JS 量到的 innerWidth（真机上实测会出现
                      // 「量出来比屏幕窄」，于是右边留一条盖不到的空带）。
                      width: "100vw",
                      maxWidth: "100vw",
                      transform: "translate(" + drawerBox.dx + "px," + drawerBox.dy + "px)"
                    }
                    : { left: 0, right: 0, bottom: 0 }
                },
                react.createElement("div", { className: "dsh-armor5-drawer-grip" },
                  react.createElement("i", null)),
                react.createElement("div", { className: "dsh-armor5-sheet-head" },
                  react.createElement("div", { className: "dsh-armor5-sheet-title" }, "无限五代")),
                react.createElement("div", { className: "dsh-armor5-tabs dsh-armor5-seg" },
                  DRAWER_TABS.map(function (row) {
                    return react.createElement("button", {
                      key: row.id,
                      type: "button",
                      className: "dsh-armor5-tab",
                      "data-tab": row.id,
                      "data-on": drawerTab === row.id ? "1" : "0",
                      onClick: function () { setDrawerTab(row.id); }
                    }, row.label,
                      row.id === "todo" && todoList.length > 0
                        ? react.createElement("span", {
                          className: "dsh-armor5-tab-count",
                          "data-count": todoDone + "/" + todoList.length
                        }, todoDone + "/" + todoList.length)
                        : null);
                  }),
                  react.createElement("span", { className: "dsh-armor5-head-right" },
                    react.createElement("span", { className: "dsh-armor5-badge", "data-tone": tone }, badgeText),
                    react.createElement("span", null, clock === "—" ? "本次会话" : clock),
                    react.createElement("span", { className: "dsh-armor5-ver" }, VERSION),
                    react.createElement("button", {
                      type: "button",
                      className: "dsh-armor5-panel-toggle",
                      "data-panel-mode": dockPrefs.panelMode === "dev" ? "dev" : "user",
                      title: dockPrefs.panelMode === "dev"
                        ? "切回用户模式（标签说人话）"
                        : "切到开发者模式（看内部字段名）",
                      "aria-label": "切换面板模式",
                      onClick: function () {
                        writePrefs({ panelMode: dockPrefs.panelMode === "dev" ? "user" : "dev" });
                      }
                    }, dockPrefs.panelMode === "dev" ? "开发者" : "用户"),
                    react.createElement("button", {
                      type: "button",
                      className: "dsh-armor5-tab-close",
                      title: "收起抽屉",
                      onClick: function () { setOpen(false); }
                    }, "✕"))),
                react.createElement("div", { className: "dsh-armor5-drawer-body" },
                  // v0.53.10：包裹框只留「任务」一页；实时 / 命中 / 明细一律平铺（各自有内层框或本就不需要）。
                  drawerTab === "todo"
                    ? react.createElement("div", { className: "dsh-armor5-frame" },
                      react.createElement("div", { className: "dsh-armor5-drawer-pane" }, drawerPane))
                    : react.createElement("div", { className: "dsh-armor5-drawer-pane dsh-armor5-drawer-pane-flat" }, drawerPane)),
                react.createElement("div", { className: "dsh-armor5-drawer-foot" },
                  react.createElement("span", null, L("位置") + " " + slotText),
                react.createElement("button", {
                  type: "button",
                  className: "dsh-armor5-mem-reset",
                  title: "清零本对话的累计计数（只清累计，判决留档不动）",
                  onClick: function () {
                    var br = liveState && liveState.link;
                    if (!br || !br.tasksPath) return;
                    // 与任务清单写通道同一个端点，只换 action（v0.51.9）。
                    panelFetch(br, br.tasksPath, "POST", { action: "resetMemory" }).then(function () {
                      if (typeof setOpen === "function") { setOpen(false); setTimeout(function () { setOpen(true); }, 60); }
                    });
                  }
                }, "重置累计"),
                  gateButton())))
            : null;

          // 两种容器二选一：open 为假时两者都不渲染（浮层默认关闭的行为不变）。
          // C 方案（v0.49.0）：浮层已删，唯一容器就是抽屉。
          var overlay = drawer;

          return react.createElement(
            "div",
            { style: { display: "inline-flex", alignItems: "center" } },
            react.createElement(
              "button",
              {
                type: "button",
                className: "dsh-armor5-root",
                ref: rootRef,
                "data-armor": "gen5",
                "data-tone": tone,
                "data-ig5-visual": visual ? visual.phase : undefined,
                "data-ig5-mark": visual && visual.mark ? visual.mark : undefined,
                // v0.52.8：浮点形态（只有一个符号、没有文字/字形）—— 由 CSS 去掉框体与内边距
                "data-ig5-float": showDot && !text ? "1" : undefined,
                "data-pressing": pressing ? "1" : undefined,
                // v0.51.11：触发条也带上面板模式 —— 「执行中 / 空闲」这类状态文字长在触发条上，
                // 上一版只收小了抽屉里的徽标，所以触发条上那串字看着还是大。
                "data-panel": dockPrefs.panelMode === "dev" ? "dev" : "user",
                title: title + "（点击或长按打开抽屉）",
                "aria-label": title + "（点击或长按打开抽屉）",
                "aria-expanded": open ? "true" : "false",
                onPointerDown: pressStart,
                onPointerUp: pressCancel,
                onPointerCancel: pressCancel,
                onPointerLeave: pressCancel,
                onPointerMove: pressMove,
                onClick: function () {
                  // 长按已经开过一次：吞掉紧随其后的 click，避免「刚开就关」。
                  if (longFired.current) { longFired.current = false; return; }
                  setOpen(true);   // C 方案（v0.49.0）：单击也开抽屉，不再切浮层。
                }
              },
              react.createElement("span", {
                className: "dsh-armor5-text",
                style: text ? undefined : { display: "none" }
              }, text),
              showDot ? react.createElement("span", {
                className: "dsh-armor5-dot",
                "data-busy": busy ? "true" : undefined,
                // v0.52.8：同一个符号表达整场判决 —— 有标记时圆点换成 ✓ / 🟠（不再另画一个）
                "data-mark": visual && visual.mark && !busy ? visual.mark : undefined
              }) : null
            ),
            overlay
          );
        }

        // ────────────────────────────────────────────────────────────────────
        // 设置台（v0.10.0）：形态 / 位置 / 侧栏入口从设置页调，不再改源码
        //
        // 宿主把「设置页的一项 = 一个 nav 按钮 + 一页独立内容」做在同一个槽位里：
        // client-ui-settings-general 里 renderSlot("settings.section", { close },
        // { only: active })，nav 行的 label 与顺序就来自注册项。官方「插件」页
        // （client-ui-settings-plugins）也是这么注册的。官方各节顺序是 账户 -10 /
        // 通用 0 / 模型 10 / 插件 15；我们声明 order 16 紧随「插件」之后（v0.11.1
        // 起，此前 -100 挤在最顶部让用户觉得别扭）。页面内容完全自己渲染 —— 不
        // require 任何宿主组件包。
        //
        // 偏好落在 localStorage["dsh-infinite-gen-5:prefs"]；没有本地存储（隐私
        // 模式 / 自检沙箱）时退化成「只在本会话生效」，不抛错。
        // ────────────────────────────────────────────────────────────────────
        var PREF_KEY = "dsh-infinite-gen-5:prefs";
        // v0.51.0：面板模式。用户模式把内部字段名换成说人话的标签；开发者模式保留内部词。
        var PANEL_MODES = { user: "用户模式（说人话，默认）", dev: "开发者模式（显示内部字段名）" };
        var PANEL_MODE = "user";
        // 内部字段名 → 用户能看懂的标签。只换标签，不动数据与判据。
        var USER_LEX = {
          "信号": "数据连接",
          "本轮": "这一轮",
          "事件速率": "动作频率",
          "最近事件": "最后动作",
          "最近工具": "用过的工具",
          "识别领域": "推测大概范围",
          "领域候选": "其它可能",
          "命中标记": "看到的关键词",
          "拒答/兜底词": "守边界时会说",
          "风险载荷": "需要小心的写法",
          "安全标记": "触到红线了吗",
          "扫描范围": "我读了多少",
          "位置": "面板位置",
          "本对话命中": "这次对话里",
          "最近对话命中": "之前几次",
          "远端凭据（GitHub · 只写不回显）": "远端凭据（GitHub）",
          "候选明细": "同类线索详情",
          "空答类型": "没答上来算哪种",
          "全局命中": "累计统计",
          "通过": "可以直接回答",
          "拒答": "已按边界改写",
          "未识别领域": "没看出类别"
        };
        // L 必须是模块级的：liveRowPairs 等模块级函数里也要翻译标签，
        // 组件内每帧把当前模式同步到这个开关上（与仓库里其它模块级状态同一风格）。
        var PANEL_LEX_STATE = { dev: false };
        var L = function (label) {
          if (PANEL_LEX_STATE.dev) return label;
          return USER_LEX[label] || label;
        };
        // v0.51.1：值级润色 —— 判决词与带数字的短语换成用户能懂的措辞。
        // 只改措辞与连接词，数字一个不动（数字是事实，措辞才是难点）。
        var V = function (text) {
          if (PANEL_LEX_STATE.dev) return text;
          var out = String(text == null ? "" : text);
          out = out.replace(/判拒\s*(\d+)\s*字/g, "重点看 $1 字");
          out = out.replace(/全文\s*(\d+)\s*字/g, "共读 $1 字");
          out = out.replace(/载荷\s*(\d+)/g, "需要小心 $1 处");
          out = out.replace(/([A-Za-z0-9_一-龥]+)\s*(\d)\*/g, "$1（$2 个线索，主判）");
          out = out.replace(/通过/g, "可以直接回答").replace(/拒答/g, "已按边界改写");
          return out;
        };
        // v0.51.2：设置台（console）的词表 —— 组标题与选项名同样分两套模式，
        // 内部语义（偏好 key 与取值）一律不动，只换显示文本。
        var CONSOLE_LEX = {
          "上屏多少信息（TRIGGER_MODE）": "面板显示多少",
          "挂到哪个槽位（SLOT_MODE）": "面板放在哪",
          "任务清单进度（宿主 todos 投影）": "任务清单",
          "领域覆盖 · 词表 · 注入健康": "识别能力与运行状态",
          "实时（信号来源 / 本轮 / 工具流水）": "实时状态",
          "触发形态": "面板显示多少",
          "glyph": "只留一个图标",
          "text": "图标 + 两个字",
          "composer": "挨着输入框（推荐）",
          "header": "会话标题栏右侧",
          "zone": "输入框上方",
          "用户模式（说人话，默认）": "说人话（默认）",
          "开发者模式（显示内部字段名）": "保留内部术语（开发者）",
          "面板用哪套词（PANEL_MODE）": "面板说哪套话",
          "触发形态": "面板长什么样",
          "形态与去重": "面板长什么样 · 重复注入怎么处理",
          "领域与工具": "识别哪些领域、能调哪些工具",
          "载荷与预算": "注入多少、花多少上下文",
          "节拍与门": "多久问一次、什么时候不问",
          "判定源": "判决是从哪来的",
          "注入面": "注进哪一段",
          "运行时锚点节拍": "末位锚点多久重发一次",
          "用户向选择（询问闸门）": "什么时候先问你",
          "预览": "面板预览",
          "摘要": "一句话小结"
        };
        var C = function (text) {
          if (PANEL_LEX_STATE.dev) return text;
          return CONSOLE_LEX[text] || text;
        };
        var PREF_DEFAULTS = Object.freeze({
          triggerMode: TRIGGER_MODE,
          slotMode: SLOT_MODE,
          panelMode: PANEL_MODE
        });
        var PREF_CHECKS = {
          triggerMode: function (v) { return TRIGGER_MODES.indexOf(v) >= 0; },
          slotMode: function (v) { return Object.prototype.hasOwnProperty.call(SLOT_MODES, v); },
          panelMode: function (v) { return Object.prototype.hasOwnProperty.call(PANEL_MODES, v); }
        };
        var CONSOLE_KEY = "armor5";
        // 设置页 nav 里排在官方「插件」那一项（order 15）后面：不常用，顺使用习惯，
        // 但仍在同一条 nav 里、点开就是自己的独立页面。
        var CONSOLE_ORDER = 16;
        var prefsCache = null;
        var prefsListeners = [];

        function safeStorage() {
          try {
            if (typeof localStorage !== "undefined" && localStorage) return localStorage;
            if (typeof window !== "undefined" && window && window.localStorage) return window.localStorage;
          } catch (err) { /* 隐私模式 / 沙箱禁止访问：只落在内存 */ }
          return null;
        }

        function readPrefs() {
          if (prefsCache) return prefsCache;
          var raw = null;
          var store = safeStorage();
          if (store) {
            try { raw = JSON.parse(store.getItem(PREF_KEY) || "null"); } catch (err) { raw = null; }
          }
          var out = {};
          for (var key in PREF_DEFAULTS) {
            var value = raw && typeof raw === "object" ? raw[key] : undefined;
            out[key] = PREF_CHECKS[key](value) === true ? value : PREF_DEFAULTS[key];
          }
          prefsCache = Object.freeze(out);
          return prefsCache;
        }

        function writePrefs(patch) {
          var current = readPrefs();
          var next = {};
          for (var key in PREF_DEFAULTS) {
            if (!patch || !Object.prototype.hasOwnProperty.call(patch, key)) {
              next[key] = current[key];
            } else {
              // 非法写入直接忽略：留着用户原来的选择，比悄悄重置成出厂值更不意外。
              next[key] = PREF_CHECKS[key](patch[key]) === true ? patch[key] : current[key];
            }
          }
          prefsCache = Object.freeze(next);
          var store = safeStorage();
          if (store) {
            try { store.setItem(PREF_KEY, JSON.stringify(next)); } catch (err) { /* 配额 / 只读 */ }
          }
          for (var i = 0; i < prefsListeners.length; i += 1) {
            try { prefsListeners[i](prefsCache); } catch (err) { /* 单个订阅者出错不影响其他 */ }
          }
          return prefsCache;
        }

        function subscribePrefs(listener) {
          prefsListeners.push(listener);
          return function () {
            var at = prefsListeners.indexOf(listener);
            if (at >= 0) prefsListeners.splice(at, 1);
          };
        }

        function usePrefs() {
          var pair = react.useState(readPrefs());
          var setCurrent = pair[1];
          react.useEffect(function () {
            return subscribePrefs(function () { setCurrent(readPrefs()); });
          }, []);
          return pair[0];
        }

        function effectiveSlotMode() {
          var mode = readPrefs().slotMode;
          return Object.prototype.hasOwnProperty.call(SLOT_MODES, mode) ? mode : SLOT_MODE;
        }

        function effectiveSlotName() {
          return SLOT_MODES[effectiveSlotMode()] || SLOT_MODES.composer;
        }

        // 设置页里的预览用与状态条同一条规则算文字：同源，避免「设置里写 A、条上显示 B」。
        var PREVIEW_TEXT = { idle: IDLE_LABEL, pass: "通过 · web(3) · 载荷 2", short: "通过 web(3)" };
        function previewOf(mode, kind) {
          // 三行预览与状态条同规则：空闲「无限五代」、执行中圆点呼吸、判决 ✓。
          var full = kind === "idle" ? PREVIEW_TEXT.idle : kind === "busy" ? "执行中" : PREVIEW_TEXT.pass;
          var short = kind === "pass" ? PREVIEW_TEXT.short : "";
          var glyph = kind === "pass" ? VERDICT_GLYPHS.pass : "";
          var text = mode === "full" ? full : mode === "compact" ? short : mode === "glyph" ? glyph : "";
          return { text: text, dot: !(mode === "glyph" && glyph !== "") };
        }

        function ArmorChoice(props) {
          return react.createElement("button", {
            type: "button",
            className: "armor5-console-choice" + (props.active ? " is-active" : ""),
            "data-choice": props.value,
            "aria-pressed": props.active ? "true" : "false",
            onClick: props.onPick
          },
            react.createElement("span", { className: "armor5-console-choice-label" }, props.label),
            props.hint ? react.createElement("span", { className: "armor5-console-choice-hint" }, props.hint) : null
          );
        }

        function ArmorPreviewRow(props) {
          var view = previewOf(props.mode, props.kind);
          return react.createElement("div", { className: "armor5-console-preview" },
            react.createElement("span", { className: "armor5-console-preview-tag" }, props.tag),
            react.createElement("span", { className: "armor5-console-dock" },
              react.createElement("span", { className: "armor5-console-meter" }, "上下文 12%"),
              react.createElement("span", { className: "armor5-console-badge", "data-kind": props.kind },
                view.text ? react.createElement("span", { className: "dsh-armor5-text" }, view.text) : null,
                view.dot ? react.createElement("span", {
                  className: "dsh-armor5-dot",
                  "data-busy": props.kind === "busy" ? "true" : undefined
                }) : null
              )
            )
          );
        }

        // ── 注入档位：设置页里的可调控面板（v0.13.0） ──────────────────────────
        // 服务端在宿主 webServer 上挂了 /infinite-gen-5/tuning，并把路径与一次性
        // token 注入 index.html（window.__IG5_TUNING__）。改档位走 POST，服务端当场
        // 卸掉注入段再按新档重装 —— 页面不必刷新，进程不必重启。
        var TUNING_SOURCE_LABEL = { ui: "设置页", config: "profile config", env: "环境变量", default: "文件默认" };
        var TUNING_PATH_FALLBACK = "infinite-gen-5/tuning";
        var TUNING_YAML_HINT = [
          "# 宿主没给调参接口时，把下面这段贴进 profile 的 cordis.patch.yml（顶层，别写成 insert）：",
          "- id: dsh-infinite-gen-5",
          "  config:",
          "    RUNTIME_ANCHOR_MODE: cadence",
          "    RUNTIME_ANCHOR_EVERY: 2"
        ].join("\n");
        // 接口拿不到时的兜底目录（服务端正常时以它下发的 catalog 为准，两边不会各写一份取值表太久）。
        var TUNING_CATALOG_FALLBACK = [
          { key: "LAYER2_MODE", label: "中段锚点（Order 200）", hint: "同源让位时优先砍掉的就是它", options: [
            { value: "anchor", label: "锚点", hint: "172 字符中段复述（默认）" },
            { value: "mirror", label: "镜像", hint: "把内核再镜像一遍（最重）" },
            { value: "off", label: "关闭", hint: "只留 Order 100 内核" }] },
          { key: "TAIL_MODE", label: "真末位锚点（Order 10150）", hint: "锚点是否恒为整份系统提示的最后一段", options: [
            { value: "waterfall", label: "瀑布末位", hint: "assemble 末端追加（默认）" },
            { value: "order", label: "按 order 排", hint: "退化到 order 10150" },
            { value: "off", label: "关闭", hint: "去掉末位锚点" }] },
          { key: "RUNTIME_ANCHOR_MODE", label: "运行时锚点节拍", hint: "每步最后一条 user 消息里的同源复述", options: [
            { value: "cadence", label: "按步换版", hint: "第 1 步 + 每 N 步换文本（默认）" },
            { value: "once", label: "只发一次", hint: "整段会话一版" },
            { value: "every", label: "每步都发", hint: "最贵" },
            { value: "off", label: "关闭", hint: "不注入运行时锚点" }] },
          { key: "RUNTIME_ANCHOR_EVERY", kind: "number", label: "节拍间隔 N", hint: "第 1 步 + 每 N 步重发" },
          { key: "ASK_GATE_MODE", label: "用户向选择（询问闸门）", hint: "只在闸门成立的那一步拼进运行时锚点", options: [
            { value: "proactive", label: "主动", hint: "任务输入 + 多步任务每一步都带合同：必问时刻做成可点按钮（默认）" },
            { value: "auto", label: "按节拍", hint: "能力位 + 节拍，用户说「别问」即静默" },
            { value: "on", label: "强制开", hint: "无提问通道时降级为写在正文里" },
            { value: "off", label: "关闭", hint: "永不出现询问/阶段条款" }] },
          { key: "ASK_GATE_EVERY", kind: "number", label: "询问闸门间隔 N", hint: "每 N 步才可能出现一次询问条款" },
          { key: "DEDUPE_PAYLOAD", kind: "bool", label: "同源让位", hint: "宿主已有同源载荷时内核让位", options: [
            { value: true, label: "开", hint: "让位（默认）" },
            { value: false, label: "关", hint: "永远注入自己的载荷" }] },
          { key: "EXCLUSIVE_SECTION", kind: "bool", label: "独占系统段", hint: "开了会丢弃宿主其余系统段，属危险档", options: [
            { value: false, label: "关", hint: "与其他系统段共存（默认）" },
            { value: true, label: "开", hint: "内核 complete" }] },
          // v0.36.2：兜底目录补齐服务端 TUNING_CATALOG 的四个后加键，否则接口拿不到时
          // 设置页会静默少掉增强集 / 惰性章节两组旋钮（服务端在时不受影响）。
          { key: "BOOST_MODE", label: "增强训练集（Order 150）", hint: "附件语料拆出的可编译单元，按本轮需求信号拼装；口风 @boost:full / @boost:off 可临时改档", options: [
            { value: "standard", label: "标准（默认）", hint: "常驻两条 + 命中项，预算 2400 B" },
            { value: "light", label: "轻量", hint: "预算 1200 B，长会话省 token" },
            { value: "full", label: "上限档", hint: "预算 4200 B，把余量吃满" },
            { value: "off", label: "关闭", hint: "零增强注入" }] },
          { key: "BOOST_BYTES", kind: "number", min: 256, max: 12000, label: "增强集字节预算", hint: "封顶值，超预算整条丢弃（绝不截半句）" },
          { key: "LAZY_MODE", label: "惰性章节（Order 160）", hint: "内核里只在特定场景才需要的章节按触发词拼回；命中不了就只留一行指针", options: [
            { value: "standard", label: "标准（默认）", hint: "命中即拼回，预算 6000 B" },
            { value: "light", label: "轻量", hint: "预算 3500 B，只回最相关的几章" },
            { value: "full", label: "全开", hint: "预算 16000 B，近于不惰性化" },
            { value: "off", label: "关闭", hint: "零拼回，最省上下文" }] },
          // LAZY_BYTES 上界跟守卫的 NUMERIC_RANGES 对齐（v0.36.3 前写 40000，比守卫的 16000 高，
          // 接口不可用走兜底目录时这个旋钮给出的档位会被服务端拒收）。
          { key: "LAZY_BYTES", kind: "number", min: 0, max: 16000, label: "惰性章节字节预算", hint: "硬上限：档位预算与本值取小；0 = 跟随档位预算（默认）" }
        ];

        // ── 面板的唯一数据来源：插件本体写好的统计数据库（v0.13.9） ──────────────
        // 服务端在 /infinite-gen-5/stats 上只读地交出数据库快照；面板不再自己拼接口、
        // 不再问插件内部结构，读到什么就画什么。老宿主（没有 __IG5_STATS__）退回
        // __IG5_TUNING__，行为与 v0.13.8 一致，不会因为一次升级把面板打死。
        // 支持反向代理子路径：/infinite-gen-5/* 必须相对当前 index.html 解析。
        function panelUrl(path) {
          if (!path) return null;
          var d = typeof document !== "undefined" ? document : null;
          if (!d || !d.baseURI) return path;
          try { return new URL(String(path).replace(/^\/+/, ""), d.baseURI).href; } catch (_) { return path; }
        }
        function statsBridge() {
          var w = typeof window !== "undefined" ? window : null;
          var stats = w && w.__IG5_STATS__;
          var legacy = w && w.__IG5_TUNING__;
          var token = (stats && stats.token) || (legacy && legacy.token);
          if (!token) return null;
          var tuning = (stats && stats.tuningPath) || (legacy && legacy.path) || "/" + TUNING_PATH_FALLBACK;
          return {
            token: token,
            statsPath: panelUrl((stats && stats.path) || null),
            tasksPath: panelUrl((stats && stats.tasksPath) || null),
            tuningPath: panelUrl(tuning),
            database: Boolean(stats && stats.path),
            // v0.15.0：核心多给了一条推送路径（SSE），面板收到「库变了」的信号就立刻回读 /stats。
            // 没有这条路径的老宿主一切照旧，仍走轮询，不会因为一次升级把面板打死。
            eventsPath: panelUrl((stats && stats.eventsPath) || null)
          };
        }

        // 与服务端同一道体积闸（v0.13.8）：超限的请求体在对端会被 destroy，
        // 页面只能看到一个看不懂的网络错误；本地先挡并给出人话，比让对端静默掐断好。
        var TUNING_BODY_LIMIT = 8192;
        function utf8Len(text) {
          if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
          return encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, "x").length;
        }

        function panelFetch(bridge, url, method, body) {
          var init = { method: method, credentials: "same-origin", headers: { "x-ig5-token": bridge.token } };
          if (body) {
            init.headers["content-type"] = "application/json";
            init.body = JSON.stringify(body);
            var size = utf8Len(init.body);
            if (size > TUNING_BODY_LIMIT) {
              return Promise.resolve({
                status: 0,
                doc: {
                  ok: false,
                  error: "面板请求体 " + size + " B 超过服务端上限 " + TUNING_BODY_LIMIT + " B（已在本地拦截，未发出请求）",
                },
              });
            }
          }
          return fetch(url, init).then(function (res) {
            return res.json().then(
              function (doc) { return { status: res.status, doc: doc }; },
              function () { return { status: res.status, doc: null }; }
            );
          });
        }

        // 统计库 → 面板。同一份 state 供面板与状态行读，避免两处各持一份。
        // v0.15.0 起改「推送优先、轮询兜底」：核心在统计库落盘后推一帧 SSE，面板收到就回读
        // /stats（推送只当闹钟，正文一律回读，前端不解析任何 HTTP 负载）；推送不可用或断线时
        // 自动回落到轮询：活跃期追得紧、空闲期放得松，页面切到后台时干脆停，省电也省日志。
        var PANEL_POLL_ACTIVE_MS = 400;
        var PANEL_POLL_IDLE_MS = 3000;
        // 「刚才还在动」的判据：这段时间内数据变过，就按活跃频率追。
        var PANEL_ACTIVE_WINDOW_MS = 6000;
        var PANEL_POLL_MS = PANEL_POLL_IDLE_MS;
        // 统计库的唯一持有者（v0.16.1）。这段状态机原来长在 useTuning() 里，于是「谁渲染谁就连一条
        // SSE」：设置页一条、浮层卡片再一条，连接数（服务端 SSE_MAX_CLIENTS = 4）与回读都要翻倍。
        // 现在提成模块级单例 —— 一条 SSE、一个自续定时器、一份 state；想读的面用 retain()/release()
        // 引用计数订阅，引用归零才停流停表（所以卡片关着时，浮层不为它多付一分钱）。
        function createStatsStore() {
          var state = {
            phase: "loading", data: null, database: null, source: null, draft: null,
            error: null, note: null, busy: false, taskBusy: false, taskNote: null,
            link: null, liveDoc: null
          };
          var subs = [];
          var refs = 0;
          var notify = function () {
            // 遍历副本：订阅者在回调里退订（组件卸载）不该把这一轮的通知错位。
            var list = subs.slice();
            for (var i = 0; i < list.length; i++) {
              try { list[i](state); } catch (error) { /* 一个订阅者崩了，不该带倒别人 */ }
            }
          };
          var update = function (part) {
            state = Object.assign({}, state, part);
            notify();
          };
          // 数据变化的时间线：stamp 是库里那份的 generatedAt，changedAt 是本地最后一次看到它变。
          // 自适应轮询靠 changedAt 判断「现在忙不忙」，不靠猜。
          var flow = { stamp: null, changedAt: 0 };
          var read = function (quiet) {
            var bridge = statsBridge();
            if (!bridge) {
              update({ phase: "unavailable", error: "宿主没有注入 __IG5_STATS__ / __IG5_TUNING__（非 Web 组合，或插件早于 v0.13.0）" });
              return;
            }
            var url = bridge.database ? bridge.statsPath : bridge.tuningPath;
            if (!url) {
              update({ phase: "unavailable", error: "统计库路径没注入（刷新页面重试）" });
              return;
            }
            if (quiet !== true) update({ phase: "loading", error: null, note: null });
            panelFetch(bridge, url, "GET").then(function (r) {
              if (r.status !== 200 || !r.doc || r.doc.ok !== true) throw new Error((r.doc && r.doc.error) || ("HTTP " + r.status));
              var doc = bridge.database ? r.doc.tuning : r.doc;
              if (!doc || !doc.effective) throw new Error("统计库里还没有档位分区（重启一次 DSH 让核心发布第一版）");
              // 数据有没有变的唯一判据是核心给的 generatedAt：推送与轮询都可能连着叫醒很多次，
              // 内容没变就不再 setState，免得面板自己抖成幻灯片（老核心没有 generatedAt 时按「变了」处理）。
              var stamp = r.doc.generatedAt || null;
              var changed = stamp === null || stamp !== flow.stamp;
              if (changed) { flow.stamp = stamp; flow.changedAt = Date.now(); }
              var part = {
                phase: "ready",
                database: bridge.database ? r.doc : null,
                source: bridge.database ? r.doc.source : null,
                data: doc,
                error: null,
                liveDoc: bridge.database ? (r.doc.live || null) : null
              };
              // 静默轮询不动 draft：用户可能正在挑档位，别把它冲掉。
              if (quiet !== true) part.draft = Object.assign({}, doc.effective);
              // 内容没变的静默回读就到此为止（推送叫醒的绝大多数帧都属于这种）。
              if (quiet === true && !changed) return;
              update(part);
            }).catch(function (error) {
              if (quiet === true) return; // 轮询失败不打扰正在用的面板，下一次自己会好
              update({ phase: "error", error: String((error && error.message) || error) });
            });
          };
          var stage = function (key, value) {
            var draft = Object.assign({}, state.draft);
            draft[key] = value;
            update({ draft: draft, note: null });
          };
          var save = function (reset) {
            var bridge = statsBridge();
            if (!bridge) return;
            update({ busy: true, error: null, note: null });
            var body = reset ? { reset: true } : { overrides: state.draft };
            panelFetch(bridge, bridge.tuningPath, "POST", body).then(function (r) {
              if (r.status !== 200 || !r.doc || r.doc.ok !== true) throw new Error((r.doc && r.doc.error) || ("HTTP " + r.status));
              var changes = (r.doc.changes || []).filter(function (k) { return r.doc.effective[k] !== undefined; });
              update({
                phase: "ready", busy: false, data: r.doc, draft: Object.assign({}, r.doc.effective), error: null,
                note: reset ? "已复位成文件默认" : ("已生效：" + (changes.length ? changes.join("、") : "无变化"))
              });
              read(true);
            }).catch(function (error) {
              update({ busy: false, error: String((error && error.message) || error) });
            });
          };
          // 任务清单的写入口：本体校验后写进会话，模型下一轮就能看见，界面也会跟着刷新。
          var writeTasks = function (action) {
            var bridge = statsBridge();
            if (!bridge) return;
            if (!bridge.tasksPath) {
              update({ taskNote: "这个宿主没有任务清单入口（需要 v0.13.9 的服务端，刷新页面重试）" });
              return;
            }
            update({ taskBusy: true, taskNote: null });
            panelFetch(bridge, bridge.tasksPath, "POST", { action: action || "restore" }).then(function (r) {
              var ok = r.status === 200 && r.doc && r.doc.ok === true;
              update({
                taskBusy: false,
                taskNote: ok
                  ? "已恢复上次清单（" + ((r.doc.todos || []).length) + " 条）：下一条消息就会带上它"
                  : "清单写入被拦：" + ((r.doc && r.doc.error) || ("HTTP " + r.status))
              });
              read(true);
            }).catch(function (error) {
              update({ taskBusy: false, taskNote: "清单写入被拦：" + String((error && error.message) || error) });
            });
          };
          // 轮询用 setTimeout 自续（前端拿到的就是这两个注入进来的定时器，别去碰全局 setInterval）。
          // transport：sse = 推送活着（根本不轮询）；polling = 兜底。link 是给面板看的一句话，同一句不重复 setState。
          var poll = { stopped: false, timer: null, transport: "polling", es: null, link: null, fellBack: false };
          var link = function (mode, text) {
            if (poll.link === text) return;
            poll.link = text;
            update({ link: { mode: mode, text: text } });
          };
          var clearTimer = function () {
            if (poll.timer && typeof clearTimeout === "function") clearTimeout(poll.timer);
            poll.timer = null;
          };
          var pageHidden = function () {
            return typeof document !== "undefined" && document.hidden === true;
          };
          // 自适应间隔：最近 PANEL_ACTIVE_WINDOW_MS 内数据变过就按活跃频率追，否则放松。
          var nextDelay = function () {
            if (pageHidden()) return null; // 页面在后台：停轮询，等 visibilitychange 再续
            return (Date.now() - flow.changedAt) < PANEL_ACTIVE_WINDOW_MS ? PANEL_POLL_ACTIVE_MS : PANEL_POLL_IDLE_MS;
          };
          var tick = function () {
            if (poll.stopped) return;
            poll.timer = null;
            if (poll.transport === "sse") return; // 推送活着就不用轮询
            read(true);
            schedule();
          };
          var schedule = function () {
            if (poll.stopped || poll.transport === "sse") return;
            clearTimer();
            var delay = nextDelay();
            if (delay === null) {
              link("paused", "页面在后台，已暂停轮询（切回来立刻补一次）");
              return;
            }
            link("polling", (poll.fellBack ? "断线回落；" : "") +
              (delay === PANEL_POLL_ACTIVE_MS ? "活跃" : "空闲") + " " + delay + " ms");
            if (typeof setTimeout === "function") poll.timer = setTimeout(tick, delay);
          };
          // 接推送：EventSource 带不了自定义请求头，所以 token 走查询串（服务端只对这条路由放行）。
          // 推送帧只当闹钟用，正文一律回读 /stats —— 前端不解析任何 HTTP 负载，这条界线不为实时化松动。
          var connect = function () {
            var bridge = statsBridge();
            if (!bridge || !bridge.eventsPath || typeof EventSource !== "function") { schedule(); return; }
            var stream;
            try {
              stream = new EventSource(bridge.eventsPath + "?token=" + encodeURIComponent(bridge.token));
            } catch (error) {
              schedule();
              return;
            }
            poll.es = stream;
            stream.onopen = function () {
              if (poll.stopped) return;
              poll.transport = "sse";
              poll.fellBack = false;
              clearTimer();
              link("sse", "推送已连接：统计库一落盘就刷新");
            };
            stream.onmessage = function () {
              if (poll.stopped) return;
              read(true);
            };
            stream.onerror = function () {
              if (poll.es) {
                try { poll.es.close(); } catch (error) { /* 已经断了 */ }
                poll.es = null;
              }
              if (poll.stopped) return;
              poll.transport = "polling";
              poll.fellBack = true;
              link("polling", "推送断线，已回落到轮询（重开面板会自动再试）");
              schedule();
            };
          };
          var onVisible = function () {
            if (poll.stopped) return;
            schedule();
            read(true);
          };
          // 引用计数：第一个订阅者进来才连流、才起步轮询；最后一个走了就收摊。
          var acquire = function () {
            refs += 1;
            if (refs > 1) return;
            read();
            poll.stopped = false;
            poll.transport = "polling";
            if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
              document.addEventListener("visibilitychange", onVisible);
            }
            connect();
            schedule();
          };
          var release = function () {
            refs = Math.max(0, refs - 1);
            if (refs > 0) return;
            poll.stopped = true;
            clearTimer();
            if (poll.es) {
              try { poll.es.close(); } catch (error) { /* 已经断了 */ }
              poll.es = null;
            }
            if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
              document.removeEventListener("visibilitychange", onVisible);
            }
          };
          return {
            state: function () { return state; },
            subscribe: function (fn) {
              subs.push(fn);
              return function () {
                var index = subs.indexOf(fn);
                if (index >= 0) subs.splice(index, 1);
              };
            },
            retain: acquire,
            release: release,
            stage: stage,
            save: save,
            read: read,
            writeTasks: writeTasks
          };
        }

        // 全插件共用一份（模块级单例）：谁渲染都读它，不再各连一条 SSE。
        var statsStore = createStatsStore();

        /**
         * 订阅统计库的通用钩子。enabled === false 时不 retain（浮层卡片关着就不连、不轮询）。
         * 每次库更新都会重渲染订阅者：state 对象每次 update 都换新的，所以比较引用即可。
         */
        function useStatsView(enabled) {
          var pair = react.useState(0);
          var bump = pair[1];
          var active = enabled !== false;
          react.useEffect(function () {
            if (!active) return undefined;
            statsStore.retain();
            var off = statsStore.subscribe(function () { bump(function (n) { return n + 1; }); });
            return function () {
              off();
              statsStore.release();
            };
          }, [active]);
          return statsStore.state();
        }

        // 设置页那条既有调用面保持不变（它现在只是单例的一个订阅者）。
        function useTuning() {
          return {
            state: useStatsView(),
            stage: statsStore.stage,
            save: statsStore.save,
            read: statsStore.read,
            writeTasks: statsStore.writeTasks
          };
        }

        function tuningStatusText(state) {
          if (state.phase === "unavailable") return "调参接口不可用（" + state.error + "）—— 下面这段 YAML 一样能改，改完重启 DSH 生效";
          if (state.phase === "loading") return "正在读取服务端的注入档位…";
          // 读取失败与保存失败都走这条：错误必须上屏，不能让按钮点了没反应。
          if (state.error) {
            return (state.phase === "error" ? "读取失败：" : "调参失败：") + state.error +
              "（token 每次启动都会换，刷新页面重试）";
          }
          var live = (state.data && state.data.live) || {};
          return "生效中：" + ((live.placements || []).length) + " 处注入 · 已重装 " + (live.rebuilds || 0) +
            " 次 · 运行时锚点已发 " + (live.anchorEmissions || 0) + " 版" + (state.note ? "　·　" + state.note : "");
        }

        // 旋钮按「载荷 → 节拍 → 形态」三组排、每组两栏。顺序与内核注入面一致；
        // 服务端将来加的新键自动落进「其他」组，不会静默漏渲染。
        var TUNING_GROUPS = [
          { title: "载荷与预算", keys: ["BOOST_MODE", "BOOST_BYTES", "LAZY_MODE", "LAZY_BYTES"] },
          { title: "节拍与门", keys: ["RUNTIME_ANCHOR_MODE", "RUNTIME_ANCHOR_EVERY", "ASK_GATE_MODE", "ASK_GATE_EVERY"] },
          { title: "形态与去重", keys: ["LAYER2_MODE", "TAIL_MODE", "DEDUPE_PAYLOAD", "EXCLUSIVE_SECTION"] }
        ];
        // 数字键的真档位：原来一律给 N=2/4/6/8，对 BOOST_BYTES（256–12000）与 LAZY_BYTES（0–40000）
        // 全是越界值，点了必被 v0.36.1 的区间守卫拒收 —— 等于四个坏按钮。这里按键给可用档位。
        var NUMERIC_STEPS = {
          BOOST_BYTES: { steps: [1200, 2400, 4200, 8000], unit: " B" },
          LAZY_BYTES: { steps: [3500, 6000, 12000, 16000], unit: " B" },
          RUNTIME_ANCHOR_EVERY: { steps: [2, 4, 6, 8], unit: "" },
          ASK_GATE_EVERY: { steps: [2, 4, 6, 8], unit: "" }
        };

        function numericOptions(item, value) {
          var spec = NUMERIC_STEPS[item.key] || null;
          var list = spec ? spec.steps.slice() : [2, 4, 6, 8];
          var min = Number(item.min);
          var max = Number(item.max);
          if (isFinite(min) || isFinite(max)) {
            list = list.filter(function (n) {
              return (!isFinite(min) || n >= min) && (!isFinite(max) || n <= max);
            });
          }
          if (list.length === 0) list = [isFinite(min) ? min : 0];
          return list.map(function (n) {
            return { value: n, label: String(n) + (spec ? spec.unit : ""), hint: Number(value) === n ? "当前" : "" };
          });
        }

        function tuningRows(state, tuner) {
          var catalog = state.data && state.data.catalog ? state.data.catalog : TUNING_CATALOG_FALLBACK;
          var sources = state.data && state.data.sources ? state.data.sources : {};
          var byKey = {};
          var placed = {};
          catalog.forEach(function (item) { byKey[item.key] = item; });
          TUNING_GROUPS.forEach(function (g) { g.keys.forEach(function (k) { placed[k] = true; }); });
          var groups = TUNING_GROUPS.map(function (g) {
            return { title: g.title, items: g.keys.map(function (k) { return byKey[k]; }).filter(Boolean) };
          }).filter(function (g) { return g.items.length > 0; });
          var rest = catalog.filter(function (item) { return !placed[item.key]; });
          if (rest.length > 0) groups.push({ title: "其他", items: rest });

          function knob(item) {
            var value = state.draft ? state.draft[item.key] : undefined;
            var tag = react.createElement("span", {
              className: "armor5-console-tag",
              "data-source": sources[item.key] || "default",
              key: "tag:" + item.key
            }, TUNING_SOURCE_LABEL[sources[item.key]] || TUNING_SOURCE_LABEL.default);
            var options = item.kind === "number"
              ? numericOptions(item, value)
              : (item.options || []);
            var cells = options.map(function (opt) {
              return react.createElement(ArmorChoice, {
                key: item.key + ":" + String(opt.value),
                value: item.key + "=" + String(opt.value),
                label: opt.label,
                hint: opt.hint,
                active: String(value) === String(opt.value),
                onPick: function () { tuner.stage(item.key, opt.value); }
              });
            });
            return react.createElement("div", { className: "armor5-knob", key: item.key, title: item.hint },
              react.createElement("div", { className: "armor5-knob-head" },
                react.createElement("span", { className: "armor5-knob-name" }, item.label),
                tag),
              react.createElement("div", { className: "armor5-console-choices armor5-console-choices-" + Math.min(cells.length, 4) }, cells)
            );
          }

          return groups.map(function (g) {
            // v0.51.16：这一整块是内核调参（注入面 / 载荷预算 / 节拍与门 / 判定源…），
            // 用户模式下整块隐藏，只留用户能懂的几组；dev 模式照旧全显示。
            return react.createElement("div", {
              className: "armor5-console-group",
              key: "grp:" + g.title,
              "data-dev-only": "1"
            },
              react.createElement("div", { className: "armor5-console-group-title" }, g.title),
              react.createElement("div", { className: "armor5-knob-grid" }, g.items.map(knob))
            );
          });
        }

        // 任务清单：读的是统计库里那份「本次会话 todos 投影的镜像」，写回宿主自己的清单。
        // 用户在这里看到的就是模型下一步会看到的进度，不必翻聊天记录数到第几步。
        var TASK_GLYPH = { completed: "✓", inProgress: "▶", pending: "○" };
        function covBar(percent, level) {
          var width = Math.max(0, Math.min(100, Number(percent) || 0));
          return react.createElement("div", { className: "armor5-cov-bar", "data-level": level || "ok" },
            react.createElement("div", { className: "armor5-cov-bar-fill", style: { width: width + "%" } }));
        }

        function covLevel(percent) {
          var value = Number(percent) || 0;
          return value >= 90 ? "danger" : value >= 75 ? "warn" : "ok";
        }

        function fmtBytes(bytes) {
          var n = Number(bytes) || 0;
          return n >= 1024 ? (Math.round((n / 1024) * 10) / 10) + " KB" : n + " B";
        }

        function coverageGroup(state) {
          var db = state.database;
          var cov = db && db.coverage ? db.coverage : null;
          if (!cov) {
            return react.createElement("div", { className: "armor5-console-group", "data-dev-only": "1" },
              react.createElement("div", { className: "armor5-console-group-title" }, C("领域覆盖 · 词表 · 注入健康")),
              react.createElement("span", { className: "armor5-console-hint" },
                state.database
                  ? "统计库里还没有覆盖分区（需要 v0.14.1 的服务端；重启一次 DSH 后由本体落盘）"
                  : "统计库不可用：" + String(state.error || "面板没拿到库路径"))
            );
          }
          var families = cov.families || {};
          var order = cov.familyOrder && cov.familyOrder.length ? cov.familyOrder : Object.keys(families);
          var labels = cov.familyLabels || {};
          var familyRows = order.map(function (id) {
            var count = Number(families[id]) || 0;
            var percent = cov.domains > 0 ? Math.round((count / cov.domains) * 100) : 0;
            return react.createElement("div", { className: "armor5-cov-row", key: "fam:" + id },
              react.createElement("span", { className: "k" }, labels[id] || id),
              covBar(percent),
              react.createElement("span", { className: "n" }, count + " 域 · " + percent + "%"));
          });
          var index = cov.index || {};
          var playbooks = cov.playbooks || {};
          var markers = cov.markers || {};
          var extended = cov.extended || {};
          var hits = cov.hits || {};
          var hitIds = Object.keys(hits);
          var hitTotal = hitIds.reduce(function (sum, id) { return sum + (Number(hits[id]) || 0); }, 0);
          var top = hitIds.map(function (id) { return [id, Number(hits[id]) || 0]; })
            .sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); })
            .slice(0, 5)
            .map(function (pair) { return pair[0] + " " + pair[1]; });
          var runtime = (db && db.runtime) || {};
          var boot = (db && db.boot) || {};
          var at = db && db.generatedAt ? Date.parse(db.generatedAt) : 0;
          var age = at ? Math.max(0, Math.round((Date.now() - at) / 1000)) : null;
          var misses = Number(cov.misses) || 0;
          // 缺口视图（v0.26.0）：还能不能加域 / 哪些域贴边 / 撞车在哪。核心算，面板只画。
          var gaps = cov.gaps || {};
          var gapTargets = gaps.targets
            ? "目标 ≥" + gaps.targets.markers + " 命中 / ≥" + gaps.targets.aliases + " 别名 / ≥" + gaps.targets.commands +
              " 命令 / ≥" + gaps.targets.toolchain + " 工具链"
            : "";
          var gapsMissing = "需要 v0.26.0 的服务端（重启一次 DSH 后由本体落盘）";
          var rows = [
            ["词表", String(extended.total || 0) + " 条扩展（别名 " + (extended.aliases || 0) + " · 命中 " + (extended.markers || 0) +
              " · 命令 " + (extended.commands || 0) + " · 工具链 " + (extended.toolchains || 0) + "）"],
            ["标记表", String(markers.total || 0) + " 个词（latin " + (markers.latin || 0) + " · cjk " + (markers.cjk || 0) +
              " · mixed " + (markers.mixed || 0) + "）"],
            ["索引", fmtBytes(index.bytes) + " / " + fmtBytes(index.budget) + "（" + (index.percent || 0) + "%）"],
            ["单包体量", fmtBytes(playbooks.min) + " – " + fmtBytes(playbooks.max) + "（护栏 " + fmtBytes(playbooks.minBytes) +
              " – " + fmtBytes(playbooks.maxBytes) + "）· " + cov.domains + " 包合计 " + fmtBytes(playbooks.total)],
            ["余量", gaps.headroom
              ? "索引还剩 " + fmtBytes(gaps.headroom.bytes) + "（均值 " + fmtBytes(gaps.headroom.perDomain) + "/域）→ 还能加 " +
                gaps.headroom.domainsAffordable + " 个域"
              : gapsMissing],
            ["薄弱域", gaps.thinCount === undefined
              ? gapsMissing
              : gaps.thinCount + " 个贴边（" + gapTargets + "）· 低于门禁下限 " + (gaps.belowLimit || []).length +
                " 个 · 非豁免 " + (gaps.deepDomains || 0) + " 域"],
            ["撞车", gaps.collisions
              ? "跨族共用 " + gaps.collisions.crossFamily + " · 共用词 " + gaps.collisions.shared + " · 签字 " +
                gaps.collisions.signed + " · 未签字 " + gaps.collisions.unsigned
              : gapsMissing],
            ["工具取用", hitTotal > 0
              ? hitTotal + " 次 · " + top.join(" · ") + (misses > 0 ? "（未命中 " + misses + " 次）" : "")
              : "本进程还没取过领域包"],
            ["加载确认", "本世代 " + (boot.generation === null || boot.generation === undefined ? "未知" : "#" + String(boot.generation)) +
              " · 启动 " + (boot.startup ? String(boot.startup).slice(0, 8) : "旧版无此记录") + " · 上次 " +
              (boot.previous
                ? "世代 " + (boot.previous.generation === null || boot.previous.generation === undefined ? "未知" : "#" + String(boot.previous.generation)) +
                  " · " + (boot.previous.at ? fmtAgo(boot.previous.at) : "时刻未知")
                : "无记录") +
              (boot.nativePluginManager ? "（DSHA 原生闸门：确认不进 profile，本行由本体自证）" : "")],
            ["健康", "库 v" + String((db && db.version) || "?") + " · pid " + String(boot.pid || "?") + " · 落盘 " +
              (age === null ? "未知" : age + " 秒前") + " · 锚点已发 " + (runtime.anchorEmissions || 0) + " 版 · 注入 " +
              (runtime.placements || []).length + " 处"],
            // v0.66.0 注入计划：面板只读计划器写下的那一份（id / bytes / reason），不自己重算。
            // 漂移与丢弃原因各占一截，省得再翻 console。
            ["注入计划", (runtime.plan ? (
              (runtime.plan.profile || "?") + "/" + (runtime.plan.mode || "?") +
              " · 进 " + ((runtime.plan.selected || []).length) + " 段（" + (((runtime.plan.budget || {}).totalBytes) || 0) + " B）" +
              " · 丢 " + ((runtime.plan.dropped || []).length) +
              " · " + String(runtime.plan.fingerprint || "无指纹") +
              ((runtime.plan.audit && runtime.plan.audit.ok === false)
                ? " · 漂移：缺 " + (((runtime.plan.audit || {}).missing || []).join(",") || "无") +
                  ((((runtime.plan.audit || {}).extra || []).length) ? " / 多 " + ((runtime.plan.audit || {}).extra || []).join(",") : "")
                : " · 与现状一致") +
              (((runtime.plan.dropped || []).length)
                ? " · 丢因 " + [...new Set((runtime.plan.dropped || []).map(function (d) { return d.reason; }))].join("/")
                : "")
            ) : "本轮还没出计划（默认只观测：装配一次就有）")]
          ];
          return react.createElement("div", { className: "armor5-console-group" },
            react.createElement("div", { className: "armor5-console-group-title" },
              "领域覆盖 · 词表 · 预算（" + cov.domains + " 域 × " + order.length + " 族）"),
            react.createElement("div", { className: "armor5-cov-rows" }, familyRows),
            react.createElement("div", { className: "armor5-cov-row" },
              react.createElement("span", { className: "k" }, "索引预算"),
              covBar(index.percent, covLevel(index.percent)),
              react.createElement("span", { className: "n" }, (index.percent || 0) + "%")),
            react.createElement("ul", { className: "armor5-console-rows" },
              rows.map(function (row) {
                return react.createElement("li", { key: row[0] },
                  react.createElement("span", { className: "k" }, row[0]),
                  react.createElement("span", { className: "v" }, row[1])
                );
              })
            ),
            react.createElement("span", { className: "armor5-console-hint" },
              "全部读插件本体落盘的统计库：域数 / 族分布 / 词表 / 预算 / 取用次数都由核心算好，面板只负责画。")
          );
        }

        // ── 实时（信号来源 / 本轮忙不忙 / 最近工具流水）（v0.15.0） ──────────────
        // 数据来自本体的 live 分区加上前端自己的传输状态：面板既不猜时间也不自己计时，
        // 只把「信号从哪来、现在在不在跑、最近调了什么工具」画出来。
        var LIVE_MODE_LABEL = { sse: "推送中", polling: "轮询中", paused: "已暂停" };
        function fmtAgo(value) {
          if (!value) return "从未";
          var ms = Date.parse(value);
          if (!Number.isFinite(ms)) return "未知";
          var seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
          return seconds < 60 ? seconds + " 秒前" : Math.round(seconds / 60) + " 分钟前";
        }
        function fmtSpan(ms) {
          var seconds = Number(ms);
          if (!Number.isFinite(seconds)) return "未知时长";
          seconds = Math.max(0, Math.round(seconds / 1000));
          return seconds < 60 ? seconds + " 秒" : Math.round(seconds / 60) + " 分钟";
        }
        /**
         * 「实时」那四行的文案，只有这一处（v0.16.1）。
         * 浮层卡片与设置页那组共用同一个构造，免得两处各写一遍、改一处忘一处。
         */
        function liveRowPairs(live, link, compact) {
          var rows = [];
          var modeText = link ? (LIVE_MODE_LABEL[link.mode] || link.mode) : "等第一条信号…";
          var freshText = live && live.at ? fmtAgo(live.at) : "";
          // compact = 浮层卡片那套田字格：半格宽只放得下一句话，链接自述（「统计库一落盘就刷新」）
          // 就留给设置页那一整行；卡片上只留「怎么连的 · 库几秒前」。
          rows.push([L("信号"), compact
            ? modeText + (freshText ? " · " + freshText : "")
            : modeText + " · " + (link ? link.text : "还没有信号") + (freshText ? "　·　库 " + freshText : "")]);
          var turn = live && live.turn ? live.turn : null;
          var events = live && live.events ? live.events : null;
          var tools = live && live.tools ? live.tools : null;
          if (!live) {
            rows.push([L("本轮"), compact
              ? "还没有实时分区"
              : "还没有实时分区（重启 DSH 后由本体落盘）"]);
          } else {
            var started = turn && turn.startedAt ? Date.parse(turn.startedAt) : NaN;
            rows.push([L("本轮"), compact
              ? (turn && turn.active
                ? "进行中 · 已 " + fmtSpan(Date.now() - started)
                : "空闲 · " + fmtAgo(turn ? turn.lastEventAt : null))
              : (turn && turn.active
                ? "进行中 · 已 " + fmtSpan(Date.now() - started) + "（最后事件 " + fmtAgo(turn.lastEventAt) + "）"
                : "空闲 · 最后事件 " + fmtAgo(turn ? turn.lastEventAt : null))]);
            // 分母用 spanMs（真正参与计算的那个跨度）：高事件率下环被截断，分子不再是 30 秒里的事，
            // 拿 windowMs 当分母就会出现「60 次 / 30 秒（3.x 次/秒）」这种自己打自己的写法。
            var spanMs = Number(events && (events.spanMs || events.windowMs)) || 0;
            rows.push([L("事件速率"), events
              ? events.count + " 次 / " + Math.round(spanMs / 1000) + " 秒 · " + (events.perSecond || 0) + "/s"
              : "—"]);
            // IG5-PANEL-STREAM-MERGE M7：事件心跳 —— live.turn.lastKind 由每个会话事件重写
            // （老服务端也有这个字段），于是这一格会随事件一句句换字，不用另开列表。
            rows.push([L("最近事件"), turn && turn.lastKind
              ? (compact
                ? String(turn.lastKind).replace(/^.*\//, "")
                : String(turn.lastKind) + " · " + fmtAgo(turn.lastEventAt))
              : "等第一条事件"]);
            // v0.50.3：服务端各处给的形状不完全一致 —— 快照里是 tools.recent（环形缓冲），
            // 流式补丁只带 tools.lastCall。以前只认 recent，于是「最近工具」常年空白。
            // 这里按 recent → ring → lastCall 依次落，拿到什么显示什么。
            var recent = [];
            if (tools && Array.isArray(tools.recent)) recent = tools.recent;
            else if (tools && Array.isArray(tools.ring)) recent = tools.ring;
            else if (tools && tools.lastCall && tools.lastCall.tool) recent = [tools.lastCall];
            rows.push([L("最近工具"), recent.length
              ? (compact
                ? recent[recent.length - 1].tool
                : recent.slice(-4).map(function (item) { return item.tool + "(" + fmtBytes(item.bytes) + ")"; }).join(" → "))
              : (compact ? "还没调过" : "本进程还没调过工具")]);
          }
          return rows;
        }
        /** 时刻格式化：数值毫秒或 ISO 串都收（判决用毫秒，统计库的命中流水用 ISO）。 */
        function clockOf(value) {
          var ms = typeof value === "string" ? Date.parse(value) : value;
          if (!ms) return "—";
          var d = new Date(ms);
          var pad = function (n) { return (n < 10 ? "0" : "") + n; };
          return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
        }
        /**
         * 最近命中流水（v0.16.2）：数据来自服务端 live.hits.recent —— 每次判决留一条，
         * 只放面板会显示的字段（时刻 / 判决 / 领域与命中数 / 载荷数 / 命中词 / 载荷词）。
         * 倒序显示：最新的在最上面，卡片一刷新就先看到刚才那一轮。
         */
        function hitRows(hits) {
          var recent = hits && Array.isArray(hits.recent) ? hits.recent : [];
          // IG5-PANEL-STREAM-MERGE M4：判决只在一个列表里，来源合流 ——
          // live.hits.stream 是服务端本轮刚落的尾巴（新服务端才有），live.hits.recent 是最近几次判决，
          // 按 at|verdict 去重后一起倒序显示；缺 stream 的老服务端行为与以前完全一致。
          var stream = hits && Array.isArray(hits.stream) ? hits.stream : [];
          var seen = {};
          var merged = [];
          var pushRow = function (row, fresh) {
            if (!row) return;
            var rowKey = String(row.at) + "|" + (row.verdict || "");
            if (seen[rowKey]) return;
            seen[rowKey] = true;
            merged.push({ row: row, fresh: fresh === true });
          };
          for (var si = stream.length - 1; si >= 0; si -= 1) pushRow(stream[si], merged.length === 0);
          for (var ri = recent.length - 1; ri >= 0; ri -= 1) pushRow(recent[ri], false);
          return merged.map(function (entry) {
            var hit = entry.row;
            var verdict = hit && hit.verdict ? hit.verdict : "—";
            var domain = hit && hit.domain
              ? hit.domain + (hit.domainHits > 1 ? "(" + hit.domainHits + ")" : "")
              : "未识别领域";
            var risk = hit && Array.isArray(hit.risk) ? hit.risk : [];
            var riskCount = hit && typeof hit.riskCount === "number" ? hit.riskCount : risk.length;
            var markers = hit && Array.isArray(hit.markers) && hit.markers.length
              ? hit.markers.join("、")
              : "无领域标记词";
            // IG5-PANEL-TUNE P3：命中行补安全标记与扫描范围，并挂一条悬停明细
            var safeWords = hit && Array.isArray(hit.safe) ? hit.safe : [];
            var rangeText = hit && hit.textChars
              ? "全文 " + hit.textChars + " 字 · 判拒 " + (hit.openingChars || 0) + " 字"
              : "";
            var titleText = [verdict, domain, markers,
              risk.length ? "载荷 " + risk.join("、") : "",
              safeWords.length ? "安全 " + safeWords.join("、") : "",
              rangeText].filter(Boolean).join("\n");
            return {
              key: String(hit && hit.at) + "|" + verdict,
              fresh: entry.fresh,
              verdict: verdict,
              title: titleText,
              main: clockOf(hit && hit.at) + " · " + verdict + " · " + domain + " · 载荷 " + riskCount,
              sub: [risk.length ? markers + "　|　" + risk.join("、") : markers,
                safeWords.length ? "安全 " + safeWords.join("、") : "",
                rangeText].filter(Boolean).join("　|　")
            };
          });
        }
        function liveGroup(state) {
          var rows = liveRowPairs(state.liveDoc, state.link);
          return react.createElement("div", { className: "armor5-console-group" },
            react.createElement("div", { className: "armor5-console-group-title" }, C("实时（信号来源 / 本轮 / 工具流水）")),
            react.createElement("ul", { className: "armor5-live-rows" },
              rows.map(function (row) {
                return react.createElement("li", { key: row[0] },
                  react.createElement("span", { className: "k" }, row[0]),
                  react.createElement("span", { className: "v" }, row[1]));
              })
            ),
            react.createElement("span", { className: "armor5-console-hint" },
              "推送只当闹钟：统计库一落盘就推一帧，面板收到立刻回读 /stats；推送不可用时自动回落到自适应轮询" +
              "（活跃 400 ms / 空闲 3 s），页面切到后台就停。同一份数据也画在状态条浮层卡片上。")
          );
        }

        /**
         * 设置页里我们自己的那一页（settings.section，排在最顶部）。
         * 只读偏好 + 写偏好，改动立刻反映到状态条（同一个 prefs 源）。
         */
                 function WakeSettings() {
           var bridge = statsBridge();
           var loadedPair = react.useState(false), loaded = loadedPair[0], setLoaded = loadedPair[1];
           var busyPair = react.useState(false), busy = busyPair[0], setBusy = busyPair[1];
           var errorPair = react.useState(null), error = errorPair[0], setError = errorPair[1];
           var enabledPair = react.useState(true), enabled = enabledPair[0], setEnabled = enabledPair[1];
           var textPair = react.useState(""), text = textPair[0], setText = textPair[1];
           var savedPair = react.useState(null), saved = savedPair[0], setSaved = savedPair[1];
           var read = function () {
             if (!bridge || !bridge.tasksPath) { setError("面板没有拿到配置入口，请刷新页面重试"); return; }
             setBusy(true); setError(null);
             panelFetch(bridge, bridge.tasksPath, "GET").then(function (r) {
               var s = r && r.doc && r.doc.settings;
               if (r && r.status === 200 && r.doc && r.doc.ok === true && s) { setEnabled(s.firstWakeEnabled !== false); setText(typeof s.identityText === "string" ? s.identityText : ""); setLoaded(true); }
               else setError((r && r.doc && r.doc.error) || ("读取失败：" + bridge.tasksPath + "（HTTP " + (r && r.status) + "）"));
             }).catch(function (e) { setError("读取异常（" + bridge.tasksPath + "）：" + String((e && e.message) || e)); }).finally(function () { setBusy(false); });
           };
           react.useEffect(read, []);
           var save = function () {
             if (!bridge || !bridge.tasksPath) { setError("面板没有拿到配置入口，请刷新页面重试"); return; }
             if (!text.trim()) { setError("人格文本不能为空"); return; }
             if (utf8Len(text) > 4000) { setError("人格文本不能超过 4000 bytes"); return; }
             setBusy(true); setError(null); setSaved(null);
             panelFetch(bridge, bridge.tasksPath, "POST", { action: "setWakeSettings", settings: { firstWakeEnabled: enabled, identityText: text } }).then(function (r) {
               var s = r && r.doc && r.doc.settings;
               if (r && r.status === 200 && r.doc && r.doc.ok === true && s) { setEnabled(s.firstWakeEnabled !== false); setText(s.identityText || ""); setSaved("已保存；仅后续新会话首条消息使用"); }
               else setError((r && r.doc && r.doc.error) || ("保存失败（HTTP " + (r && r.status) + "）"));
             }).catch(function (e) { setError("保存异常：" + String((e && e.message) || e)); }).finally(function () { setBusy(false); });
           };
           var reset = function () {
             if (!bridge || !bridge.tasksPath) return;
             setBusy(true); setError(null); setSaved(null);
             panelFetch(bridge, bridge.tasksPath, "POST", { action: "resetWakeSettings" }).then(function (r) {
               var s = r && r.doc && r.doc.settings;
               if (r && r.status === 200 && r.doc && r.doc.ok === true && s) { setEnabled(s.firstWakeEnabled !== false); setText(s.identityText || ""); setSaved("已恢复默认"); }
               else setError((r && r.doc && r.doc.error) || ("恢复失败（HTTP " + (r && r.status) + "）"));
             }).catch(function (e) { setError("恢复异常：" + String((e && e.message) || e)); }).finally(function () { setBusy(false); });
           };
           return react.createElement("div", { className: "armor5-console-group" },
             react.createElement("div", { className: "armor5-console-group-title" }, "AI 身份与人格"),
             react.createElement("div", { className: "armor5-console-hint" }, "唤醒词「亲爱的」仅在无历史新会话的首条消息生效；配置由服务端保存。只读自检词：无限第五代自检。"),
             react.createElement("label", null, react.createElement("input", { type: "checkbox", checked: enabled, disabled: busy || !loaded, onChange: function (e) { setEnabled(e.target.checked); setSaved(null); } }), " 开启首轮身份唤醒（默认）"),
             react.createElement("textarea", { className: "armor5-console-secret-input", rows: 6, maxLength: 4000, value: text, disabled: busy || !loaded, placeholder: "填写 AI 的身份、人格与回答风格…", onChange: function (e) { setText(e.target.value); setSaved(null); } }),
             react.createElement("div", { className: "armor5-console-foot" },
               react.createElement("button", { type: "button", className: "armor5-console-btn is-primary", disabled: busy || !loaded, onClick: save }, busy ? "处理中…" : "保存人格"),
               react.createElement("button", { type: "button", className: "armor5-console-btn", disabled: busy, onClick: reset }, "恢复人格默认"),
               react.createElement("button", { type: "button", className: "armor5-console-btn", disabled: busy, onClick: read }, "重新读取")
             ),
             !loaded && !error ? react.createElement("div", { className: "armor5-console-hint" }, "正在读取配置…") : null,
             error ? react.createElement("div", { className: "armor5-console-hint" }, error) : null,
             saved ? react.createElement("div", { className: "armor5-console-hint" }, saved) : null
           );
         }

         function ArmorConsolePage(props) {
          var tuner = useTuning();
          var prefs = usePrefs();
          var mode = prefs.triggerMode;
          var onClose = props && typeof props.close === "function" ? props.close : null;
          var store = safeStorage();
          // 后端设置面板自己保活样式：状态条没挂 / 已卸载时，这一页的包裹框与网格不塌。
          react.useEffect(function () { ensureArmor5Style(); }, []);

          function pick(field, value) {
            var patch = {};
            patch[field] = value;
            return function () { writePrefs(patch); };
          }

          // 只读块只留一眼看不出来的东西：形态与位置的选择就在上面两组按钮里，再抄一遍只是占高度
          // （v0.36.2 起合成一行）。另两行此前是旧口径 —— 注入面早已是六段瀑布，判定源的投影键
          // 也是内核自己那把（`armor` 是留给四代的旧键，见 PROJ_KEY 上方注释）。
          var rows = [
            ["版本", TITLE],
            ["上屏·位置", mode + " · " + prefs.slotMode + " → " + (SLOT_MODES[prefs.slotMode] || SLOT_MODES.composer)],
            ["注入面", "Order 100 常驻内核 + 118 运行时锚点 / 150 增强集 / 160 惰性章节 / 170 批量交付合同 / 200 中段锚点 / 10150 末位锚点"],
            ["判定源", "本次会话的实时投影（key infinite-gen-5:armor），判决一直留到你的下一条发言"],
            // 域数不再写死：读本体 coverage 分区（库还没发布时显示占位，不谎报数字）。
            ["领域与工具", ((tuner.state.database && tuner.state.database.coverage && tuner.state.database.coverage.domains) || "—") +
              " 域 × 7 族；infinite_gen5_scenario 取领域包，infinite_gen5_env 看本机环境"],
            ["存储", store ? "本机 localStorage（" + PREF_KEY + "）" : "仅本会话（当前环境没有本地存储）"]
          ];

          var modeChoices = [
            { value: "glyph", label: "✓ 记号", hint: "空闲/执行中只有圆点，判决只一个字符（默认）" },
            { value: "compact", label: "短词", hint: "判决写「通过 web(3)」" },
            { value: "full", label: "长文字", hint: "判决写「通过 · web(3) · 载荷 2」" },
            { value: "dot", label: "纯圆点", hint: "上屏只有圆点，全部信息进浮层" }
          ].map(function (row) {
            return react.createElement(ArmorChoice, {
              key: row.value,
              value: row.value,
              label: row.label,
              hint: row.hint,
              active: mode === row.value,
              onPick: pick("triggerMode", row.value)
            });
          });

          // v0.51.20 · SECRETS 协议：远端凭据入口 —— 只写不回显，界面只显示状态与末四位。
          var secretPair = react.useState(null);
          var secret = secretPair[0];
          var setSecret = secretPair[1];
          var secretInputPair = react.useState("");
          var secretInput = secretInputPair[0];
          var setSecretInput = secretInputPair[1];
          var postSecret = function (body) {
            // v0.51.22 修：bridge 来自 statsBridge()（同文件 writeTasks/save 都这么取），
            // 回执是 { status, doc }，必须判 status —— 上一版用 state.link 且只读 r.doc，
            // 调用时抛 ReferenceError，于是「保存凭据」毫无反馈。
            var bridge = statsBridge();
            if (!bridge || !bridge.tasksPath) { setSecret({ ok: false, error: "面板没拿到凭据入口（刷新页面重试）" }); return; }
            setSecret({ ok: null, busy: true });
            panelFetch(bridge, bridge.tasksPath, "POST", body).then(function (r) {
              var doc = r && r.doc ? r.doc : null;
              var ok = r && r.status === 200 && doc && doc.ok === true;
              setSecret(ok ? doc : { ok: false, error: (doc && doc.error) || ("HTTP " + (r && r.status)) });
              if (ok && body.action === "setGithubToken") setSecretInput("");
            }).catch(function (error) {
              setSecret({ ok: false, error: "写入异常：" + String((error && error.message) || error) });
            });
          };
          var secretStatusText = secret && secret.busy ? "写入中…" : !secret ? "未读取（保存或清除后显示）"
            : secret.ok === false ? ("失败：" + (secret.error || "未知"))
              : secret.configured ? ("已保存 · 末四位 ****" + secret.last4 + " · " + (secret.path || "") + (secret.mode ? " (" + secret.mode + ")" : ""))
                : "未配置";

          var panelChoices = [
            { value: "user", hint: "说人话的标签（出厂默认，推荐日常使用）" },
            { value: "dev", hint: "保留内部字段名（判拒窗口 / 领域候选 / composer.dock），便于自查" }
          ].map(function (row) {
            return react.createElement(ArmorChoice, {
              key: row.value,
              value: row.value,
              label: C(PANEL_MODES[row.value] || row.value),
              hint: row.hint,
              active: prefs.panelMode === row.value,
              onPick: pick("panelMode", row.value)
            });
          });

          var slotChoices = [
            { value: "composer", hint: "与原生计量器同排（推荐）" },
            { value: "header", hint: "会话标题栏右侧角落" },
            { value: "zone", hint: "输入框上方，与任务列表同列" }
          ].map(function (row) {
            return react.createElement(ArmorChoice, {
              key: row.value,
              value: row.value,
              label: C(row.value),
              hint: row.hint,
              active: prefs.slotMode === row.value,
              onPick: pick("slotMode", row.value)
            });
          });

          // v0.49.0（C 方案）：设置页那一组「点开之后用哪种容器」已删除 —— 只有抽屉一种容器，
          // 触发方式是单击或长按触发条。偏好项里也不再保留 layoutMode。

          return react.createElement("div", {
            className: "armor5-console",
            "data-panel": prefs.panelMode || "user"
          },
            react.createElement("div", { className: "armor5-console-head" },
              react.createElement("div", { className: "armor5-console-title" },
                react.createElement("b", null, IDLE_LABEL),
                react.createElement("span", { className: "armor5-console-ver" }, VERSION)
              ),
              react.createElement("span", { className: "armor5-console-hint" }, "改完立即生效，偏好存在本机")
            ),
            react.createElement("div", { className: "armor5-console-group" },
              react.createElement("div", { className: "armor5-console-group-title" }, C("上屏多少信息（TRIGGER_MODE）")),
              react.createElement("div", { className: "armor5-console-choices armor5-console-choices-2" }, modeChoices)
            ),
            react.createElement("div", { className: "armor5-console-group" },
              react.createElement("div", { className: "armor5-console-group-title" }, C("预览")),
              react.createElement("div", { className: "armor5-console-previews" },
                react.createElement(ArmorPreviewRow, { mode: mode, kind: "idle", tag: "空闲" }),
                react.createElement(ArmorPreviewRow, { mode: mode, kind: "busy", tag: "执行中" }),
                react.createElement(ArmorPreviewRow, { mode: mode, kind: "pass", tag: "判决" })
              )
            ),
            react.createElement("div", { className: "armor5-console-group" },
              react.createElement("div", { className: "armor5-console-group-title" }, C("挂到哪个槽位（SLOT_MODE）")),
              react.createElement("div", { className: "armor5-console-choices armor5-console-choices-3" }, slotChoices),
              react.createElement("div", { className: "armor5-console-group-title" }, C("面板用哪套词（PANEL_MODE）")),
              react.createElement("div", { className: "armor5-console-choices armor5-console-choices-2" }, panelChoices)
            ),
            react.createElement("div", { className: "armor5-console-group", "data-dev-only": "1" },
              react.createElement("div", { className: "armor5-console-group-title" }, C("远端凭据（GitHub · 只写不回显）")),
              react.createElement("div", { className: "armor5-console-choices armor5-console-choices-1" },
                react.createElement("input", {
                  type: "password",
                  className: "armor5-console-secret-input",
                  value: secretInput,
                  placeholder: "粘贴 GitHub token（只写盘、不回显）",
                  onChange: function (e) { setSecretInput(e.target.value); }
                }),
                react.createElement("button", {
                  type: "button",
                  onClick: function () { postSecret({ action: "setGithubToken", token: secretInput }); }
                }, "保存凭据"),
                react.createElement("button", {
                  type: "button",
                  onClick: function () { postSecret({ action: "clearGithubToken" }); }
                }, "清除凭据"),
                react.createElement("span", { className: "armor5-console-hint" }, secretStatusText)
              )
            ),
            react.createElement("div", { className: "armor5-console-group", "data-dev-only": "1" },
              react.createElement("div", { className: "armor5-console-group-title" }, "注入档位（改完点保存，服务端当场重装，不必重启）"),
              react.createElement("span", { className: "armor5-console-hint" }, tuningStatusText(tuner.state)),
              tuner.state.phase === "ready"
                ? react.createElement("div", null, tuningRows(tuner.state, tuner))
                : react.createElement("pre", { className: "armor5-console-yaml" }, TUNING_YAML_HINT),
              react.createElement("div", { className: "armor5-console-foot" },
                react.createElement("button", {
                  type: "button",
                  className: "armor5-console-btn armor5-tune-btn is-primary",
                  disabled: tuner.state.busy === true || tuner.state.phase !== "ready",
                  onClick: function () { tuner.save(false); }
                }, tuner.state.busy ? "正在生效…" : "保存并生效"),
                react.createElement("button", {
                  type: "button",
                  className: "armor5-console-btn armor5-tune-btn",
                  onClick: function () { tuner.save(true); }
                }, "档位复位到默认"),
                react.createElement("button", {
                  type: "button",
                  className: "armor5-console-btn armor5-tune-btn",
                  onClick: function () { tuner.read(); }
                }, "重新读取")
              )
            ),
            react.createElement(WakeSettings, null),
             liveGroup(tuner.state),
            coverageGroup(tuner.state),
            react.createElement("div", { className: "armor5-console-group", "data-dev-only": "1" },
              react.createElement("div", { className: "armor5-console-group-title" }, "只读"),
              react.createElement("ul", { className: "armor5-console-rows" },
                rows.map(function (row) {
                  return react.createElement("li", { key: row[0] },
                    react.createElement("span", { className: "k" }, row[0]),
                    react.createElement("span", { className: "v" }, row[1])
                  );
                })
              )
            ),
            react.createElement("div", { className: "armor5-console-foot" },
              react.createElement("button", {
                type: "button",
                className: "armor5-console-btn",
                onClick: function () { writePrefs(PREF_DEFAULTS); }
              }, "恢复默认"),
              onClose ? react.createElement("button", {
                type: "button",
                className: "armor5-console-btn is-primary",
                onClick: onClose
              }, "完成") : null
            )
          );
        }

        function apply(ctx) {
          // 状态条：槽位在注册期决定，改「位置」偏好就得卸掉旧的重新挂一次。
          var status = { mode: null, dispose: null };
          function mountStatus() {
            var mode = effectiveSlotMode();
            if (status.mode === mode) return;
            if (typeof status.dispose === "function") status.dispose();
            var slotName = SLOT_MODES[mode] || SLOT_MODES.composer;
            // inject 只在宿主声明了该槽位后才回调，所以未声明的槽位不会抛错，只是不渲染。
            var dispose = ctx.slots.inject(slotName, function () {
              return ctx.slots.register({
                name: slotName,
                id: SLOT_ID,
                order: SLOT_ORDER
              }, ArmorDock);
            });
            status.mode = mode;
            status.dispose = typeof dispose === "function" ? dispose : null;
          }
          mountStatus();
          var offStatus = subscribePrefs(mountStatus);

          // 设置页最顶部的入口 + 我们自己的那一页（独立渲染，不依赖宿主组件包）。
          var offSection = ctx.slots.inject("settings.section", function () {
            return ctx.slots.register({
              name: "settings.section",
              id: CONSOLE_KEY,
              order: CONSOLE_ORDER,
              label: function () { return IDLE_LABEL; }
            }, ArmorConsolePage);
          });

          // v0.16.2：可选的侧栏入口整块移除 —— 它跟设置页是同一张脸，多一个入口只多一份
          // 维护与一份样式债；要看数据点状态条那颗徽标。
          function dispose() {
            offStatus();
            if (typeof offSection === "function") offSection();
            if (typeof status.dispose === "function") status.dispose();
          }
          if (typeof ctx.effect === "function") {
            ctx.effect(function () { return dispose; }, "ui-armor5: 状态条与设置台");
          }
          return dispose;
        }

        exports.name = "dsh-infinite-gen-5";
        exports.inject = ["slots"];
        exports.apply = apply;
        // 供自检脚本读取（浏览器侧无副作用）。
        // 设置台的程序化入口，与页面里点选走同一条路径（改完立刻通知订阅者）。
        exports.getPrefs = function () { return readPrefs(); };
        exports.setPrefs = function (patch) { return writePrefs(patch); };

        exports.__meta = {
          version: VERSION,
          slotMode: SLOT_MODE,
          slotName: SLOT_NAME,
          styleId: STYLE_ID,
          idleLabel: IDLE_LABEL,
          triggerMode: TRIGGER_MODE,
          triggerModes: TRIGGER_MODES,
          verdictGlyphs: VERDICT_GLYPHS,
          prefKey: PREF_KEY,
          prefDefaults: PREF_DEFAULTS,
          prefFields: Object.keys(PREF_DEFAULTS),
          consoleKey: CONSOLE_KEY,
          consoleOrder: CONSOLE_ORDER,
          sectionSlot: "settings.section"
        };
        return module.exports;
      }
    });
  } catch (err) {
    console.warn('[AI Client Sandbox] dsh-infinite-gen-5 runtime error:', err);
  }
})();
