import { Component, type ReactNode } from "react";

/**
 * Last-resort crash boundary.
 *
 * Without an error boundary a single render-time throw unmounts the whole
 * React root and the window goes blank (a black/white screen depending on the
 * theme). This boundary catches that throw, shows a readable panel with the
 * error message + stack so the failure is visible instead of a dead screen,
 * and offers a reload. It is intentionally dependency-free: if the crash is
 * inside i18n/theme/store, the boundary must still render, so it uses inline
 * styles and hardcoded bilingual text rather than the app's i18n/theme.
 */
type Props = { children: ReactNode };

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error("ErrorBoundary caught:", error, info);
  }

  private reload = (): void => {
    window.location.reload();
  };

  private dismiss = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "#0d0f14",
            color: "#e6e6e6",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          }}
        >
          <div
            style={{
              maxWidth: 640,
              width: "100%",
              border: "1px solid #333",
              borderRadius: 10,
              background: "#16181f",
              padding: 20,
            }}
          >
            <h1
              style={{
                fontSize: 15,
                fontWeight: 600,
                margin: "0 0 12px",
                color: "#ff6b6b",
              }}
            >
              YaMet 遇到问题 / Something went wrong
            </h1>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12,
                lineHeight: 1.5,
                color: "#c8c8c8",
                background: "#0d0f14",
                padding: 12,
                borderRadius: 6,
                maxHeight: "40vh",
                overflow: "auto",
              }}
            >
              {e.message || String(e)}
              {"\n\n"}
              {e.stack || ""}
            </pre>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={this.reload}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: "#222",
                  color: "#e6e6e6",
                  cursor: "pointer",
                }}
              >
                重新加载 / Reload
              </button>
              <button
                type="button"
                onClick={this.dismiss}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: "transparent",
                  color: "#888",
                  cursor: "pointer",
                }}
              >
                关闭 / Dismiss
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
