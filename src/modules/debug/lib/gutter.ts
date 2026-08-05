// CodeMirror gutter that renders debug breakpoints for the currently open
// file. Reads from the shared breakpoint store, toggles on click, and
// re-renders when the store changes or a debug session moves `stoppedAt`.

import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type ViewUpdate,
} from "@codemirror/view";
import {
  linesFor,
  stoppedAtFor,
  subscribeBreakpoints,
  toggleBreakpoint,
} from "./breakpoints";

class BreakpointMarker extends GutterMarker {
  elementClass = "cm-breakpoint";
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-breakpoint-dot";
    return el;
  }
}
class StoppedMarker extends GutterMarker {
  elementClass = "cm-breakpoint-stopped";
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-breakpoint-stopped-mark";
    return el;
  }
}
const breakpointMarker = new BreakpointMarker();
const stoppedMarker = new StoppedMarker();

/** Serialized breakpoint state for the open file, held in CM state so the
 * gutter reacts to store changes via a dispatched effect. */
const setBreakpointsEffect = StateEffect.define<{
  lines: number[];
  stopped: number | null;
}>();

const breakpointField = StateField.define<{
  lines: number[];
  stopped: number | null;
}>({
  create: () => ({ lines: [], stopped: null }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setBreakpointsEffect)) value = e.value;
    }
    return value;
  },
});

/** A ViewPlugin that subscribes to the shared store for `path` and dispatches
 * an effect on every change, so the gutter markers stay in sync. Unsubscribes
 * on destroy. */
const breakpointSync = (path: () => string) =>
  ViewPlugin.fromClass(
    class {
      private unsub: (() => void) | null = null;
      constructor(readonly view: EditorView) {
        this.unsub = subscribeBreakpoints(() => {
          const p = path();
          view.dispatch({
            effects: setBreakpointsEffect.of({
              lines: linesFor(p),
              stopped: stoppedAtFor(p),
            }),
          });
        });
        view.dispatch({
          effects: setBreakpointsEffect.of({
            lines: linesFor(path()),
            stopped: stoppedAtFor(path()),
          }),
        });
      }
      update(_u: ViewUpdate) {}
      destroy() {
        this.unsub?.();
        this.unsub = null;
      }
    },
  );

/**
 * Breakpoint gutter for a single editor. `path` returns the absolute path of
 * the currently-open file; the gutter re-reads the store on every store change
 * and toggles a breakpoint on mousedown.
 */
export function breakpointGutter(path: () => string): Extension {
  const brGutter = gutter({
    class: "cm-breakpoint-gutter",
    renderEmptyElements: true,
    markers: (view) => {
      const { lines, stopped } = view.state.field(breakpointField);
      const builder = new RangeSetBuilder<GutterMarker>();
      for (const line of lines) {
        const l = view.state.doc.line(Math.min(line, view.state.doc.lines));
        builder.add(l.from, l.to, breakpointMarker);
      }
      if (stopped != null) {
        const l = view.state.doc.line(Math.min(stopped, view.state.doc.lines));
        builder.add(l.from, l.to, stoppedMarker);
      }
      return builder.finish();
    },
    domEventHandlers: {
      mousedown(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        toggleBreakpoint(path(), lineNo);
        return true;
      },
    },
  });

  return [
    breakpointField,
    brGutter,
    breakpointGutterStyle,
    breakpointSync(path),
  ];
}

const breakpointGutterStyle = EditorView.theme({
  ".cm-breakpoint-gutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ".cm-breakpoint-dot": {
    width: "9px",
    height: "9px",
    borderRadius: "50%",
    background: "#e53935",
    cursor: "pointer",
    transition: "transform .1s ease",
  },
  ".cm-breakpoint-dot:hover": { transform: "scale(1.25)" },
  ".cm-breakpoint-stopped-mark": {
    width: "10px",
    height: "10px",
    borderRadius: "2px",
    background: "#f6c343",
    boxShadow: "0 0 6px rgba(246,195,67,.9)",
  },
  ".cm-breakpoint-gutter-wrap .cm-gutters": { background: "transparent" },
});
