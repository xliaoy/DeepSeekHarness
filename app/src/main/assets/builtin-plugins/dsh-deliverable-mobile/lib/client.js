(() => {
  try {
    window.__ModuleLoader__.load({
      id: "dsh-deliverable-mobile",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        var React = require("react");

        var inject = ["slots"];

        var OPEN_ROUTE = "/api/deliverable.mobile-open";

        var STYLE = {
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          height: "30px",
          padding: "0 12px",
          border: "1px solid var(--dsw-alias-border-l2)",
          borderRadius: "8px",
          background: "var(--dsw-alias-bg-layer-1)",
          color: "var(--dsw-alias-label-primary)",
          fontFamily: "inherit",
          fontSize: "12px",
          lineHeight: "18px",
          cursor: "pointer",
          flex: "none",
          whiteSpace: "nowrap",
        };

        var BUSY_STYLE = Object.assign({}, STYLE, { opacity: 0.55, cursor: "default" });

        /** 图标共用的几何：16 线框、1.5 描边、currentColor 跟随按钮状态色。 */
        var ICON_PROPS = {
          viewBox: "0 0 16 16",
          width: 14,
          height: 14,
          fill: "none",
          "aria-hidden": "true",
          focusable: "false",
          style: { flex: "none", display: "block" },
        };

        var STROKE = {
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        };

        /** 「用其他应用打开」：文档框 + 右上角离开的箭头（系统 open-in 语义）。 */
        function OpenIcon() {
          return React.createElement("svg", ICON_PROPS,
            React.createElement("path", Object.assign({
              d: "M7 2.75H4.25A1.5 1.5 0 0 0 2.75 4.25v7.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V9",
            }, STROKE)),
            React.createElement("path", Object.assign({ d: "M9.75 2.75h3.5v3.5" }, STROKE)),
            React.createElement("path", Object.assign({ d: "M13.25 2.75 7.75 8.25" }, STROKE)));
        }

        /** 进行中：淡底圆环 + 旋转的 1/4 弧。SMIL 自带动画，不注入全局样式。 */
        function BusyIcon() {
          return React.createElement("svg", ICON_PROPS,
            React.createElement("circle", {
              cx: 8, cy: 8, r: 5.5,
              stroke: "currentColor", strokeWidth: 1.5, opacity: 0.25,
            }),
            React.createElement("path", Object.assign({ d: "M13.5 8A5.5 5.5 0 0 0 8 2.5" }, STROKE),
              React.createElement("animateTransform", {
                attributeName: "transform",
                type: "rotate",
                from: "0 8 8",
                to: "360 8 8",
                dur: "0.8s",
                repeatCount: "indefinite",
              })));
        }

        /** 已唤起：对勾。 */
        function DoneIcon() {
          return React.createElement("svg", ICON_PROPS,
            React.createElement("path", Object.assign({ d: "M3 8.5 6.25 11.75 13 5" }, STROKE)));
        }

        /** 失败：警示三角 + 感叹号。 */
        function ErrorIcon() {
          return React.createElement("svg", ICON_PROPS,
            React.createElement("path", Object.assign({
              d: "M7.13 2.98a1 1 0 0 1 1.74 0l5.13 8.77a1 1 0 0 1-.87 1.5H2.87a1 1 0 0 1-.87-1.5l5.13-8.77Z",
            }, STROKE)),
            React.createElement("path", Object.assign({ d: "M8 6.5v2.75" }, STROKE)),
            React.createElement("path", Object.assign({ d: "M8 11.25h.01" }, STROKE)));
        }

        function MobileOpenAction(props) {
          var actionUrl = props.actionUrl;
          var pending = props.pending;
          var phaseState = React.useState("idle");
          var phase = phaseState[0];
          var setPhase = phaseState[1];
          // 失败原因必须进 state：局部变量会被 setPhase 触发的重渲染清掉，
          // 错误分支就只剩兜底文案，真正的原因（桥未就绪 / 坐标失效）丢失。
          var messageState = React.useState("");
          var errorMessage = messageState[0];
          var setErrorMessage = messageState[1];

          var fail = (message) => {
            setErrorMessage(message);
            setPhase("error");
            console.warn("[dsh-deliverable-mobile] open failed:", message);
          };

          var onClick = async () => {
            if (phase === "busy") return;
            setErrorMessage("");
            setPhase("busy");
            try {
              var coords = actionUrl ? new URL(actionUrl, window.location.origin).searchParams : null;
              var sessionId = coords ? coords.get("sessionId") : null;
              var seq = coords ? coords.get("seq") : null;
              var index = coords ? coords.get("index") : null;
              if (!sessionId || !seq || !index) throw new Error("交付文件坐标缺失");
              var response = await fetch(OPEN_ROUTE + "?sessionId=" + encodeURIComponent(sessionId)
                  + "&seq=" + encodeURIComponent(seq) + "&index=" + encodeURIComponent(index), {
                method: "GET",
                signal: AbortSignal.timeout(90000),
              });
              var payload = await response.json().catch(() => null);
              if (!response.ok || payload === null || payload.ok !== true) {
                fail(payload && payload.error && payload.error.message
                  ? payload.error.message
                  : "唤起失败(HTTP " + response.status + ")");
                return;
              }
              setPhase("done");
            } catch (reason) {
              fail(reason && reason.message ? String(reason.message) : String(reason));
            }
          };

          if (phase === "done") {
            return React.createElement("span", {
              style: Object.assign({}, STYLE, {
                cursor: "default",
                borderColor: "var(--dsw-alias-state-success-secondary)",
                color: "var(--dsw-alias-state-success-primary)",
              }),
              "data-dsh-deliverable-mobile": "done",
            }, React.createElement(DoneIcon), "已唤起打开方式");
          }
          if (phase === "error") {
            var errorText = errorMessage || "唤起失败";
            return React.createElement("span", {
              style: Object.assign({}, STYLE, {
                cursor: "default",
                borderColor: "var(--dsw-alias-state-error-secondary)",
                color: "var(--dsw-alias-state-error-primary)",
              }),
              "data-dsh-deliverable-mobile": "error",
              title: errorText,
            }, React.createElement(ErrorIcon), "唤起失败：" + errorText.slice(0, 40));
          }
          var busy = phase === "busy";
          return React.createElement("button", {
            type: "button",
            style: busy ? BUSY_STYLE : STYLE,
            disabled: busy || !!pending,
            onClick: onClick,
            "data-dsh-deliverable-mobile": "open",
            title: "导出并选择用其他应用打开（MT 管理器 / 文件管理器等）",
          }, React.createElement(busy ? BusyIcon : OpenIcon), busy ? "打开中…" : "用其他应用打开");
        }

        function apply(ctx) {
          ctx.slots.inject("deliverables.file.actions", () => ctx.slots.register({
            name: "deliverables.file.actions",
            id: "dsh-deliverable-mobile",
            order: 10,
          }, MobileOpenAction));
        }

        exports.name = "dsh-deliverable-mobile";
        exports.inject = inject;
        exports.apply = apply;
        return module.exports;
      },
    });
  } catch (err) {
    console.warn("[dsh-deliverable-mobile] runtime error:", err);
  }
})();
