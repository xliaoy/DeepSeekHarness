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

        var EXPORT_ROUTE = "/api/deliverable.mobile-export";

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

        function MobileOpenAction(props) {
          var actionUrl = props.actionUrl;
          var pending = props.pending;
          var state = React.useState("idle");
          var phase = state[0];
          var setPhase = state[1];

          var onClick = async () => {
            if (phase === "busy") return;
            setPhase("busy");
            try {
              var coords = actionUrl ? new URL(actionUrl, window.location.origin).searchParams : null;
              var sessionId = coords ? coords.get("sessionId") : null;
              var seq = coords ? coords.get("seq") : null;
              var index = coords ? coords.get("index") : null;
              if (!sessionId || !seq || !index) throw new Error("交付文件坐标缺失");
              var response = await fetch(EXPORT_ROUTE + "?sessionId=" + encodeURIComponent(sessionId)
                  + "&seq=" + encodeURIComponent(seq) + "&index=" + encodeURIComponent(index), {
                method: "GET",
                signal: AbortSignal.timeout(90000),
              });
              var payload = await response.json().catch(() => null);
              if (!response.ok || payload === null || payload.ok !== true) {
                var message = payload && payload.error && payload.error.message ? payload.error.message : "导出失败";
                setPhase("error");
                console.warn("[dsh-deliverable-mobile] export failed:", message);
                return;
              }
              setPhase("done");
            } catch (reason) {
              setPhase("error");
              console.warn("[dsh-deliverable-mobile] export error:", reason);
            }
          };

          if (phase === "done") {
            return React.createElement("span", {
              style: Object.assign({}, STYLE, { borderColor: "var(--dsw-alias-state-success-secondary)", color: "var(--dsw-alias-state-success-primary)" }),
              "data-dsh-deliverable-mobile": "done",
            }, "已导出到 下载/DeepSeekHarness");
          }
          if (phase === "error") {
            return React.createElement("span", {
              style: Object.assign({}, STYLE, { borderColor: "var(--dsw-alias-state-error-secondary)", color: "var(--dsw-alias-state-error-primary)" }),
              "data-dsh-deliverable-mobile": "error",
            }, "导出失败");
          }
          return React.createElement("button", {
            type: "button",
            style: phase === "busy" ? BUSY_STYLE : STYLE,
            disabled: phase === "busy" || !!pending,
            onClick: onClick,
            "data-dsh-deliverable-mobile": "open",
            title: "导出到 Download/DeepSeekHarness，用手机文件管理器/MT 管理器打开",
          }, phase === "busy" ? "导出中…" : "📱 手机查看");
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
