import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import { useDapStore } from "./store";

const setBreakpointsEffect = StateEffect.define<Set<number>>();

class BreakpointMarker extends GutterMarker {
  constructor(readonly active: boolean) {
    super();
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.active ? "cm-dap-bp cm-dap-bp-on" : "cm-dap-bp";
    return el;
  }
}

const onMarker = new BreakpointMarker(true);
const offMarker = new BreakpointMarker(false);

/**
 * Click-to-toggle breakpoint gutter. Breakpoint state lives in a per-editor
 * StateField seeded from the DAP store; toggling syncs both directions and
 * pushes setBreakpoints to the active adapter when a session is running.
 */
export function breakpointGutter(getPath: () => string): Extension {
  const field = StateField.define<Set<number>>({
    create: () => new Set(useDapStore.getState().breakpoints[getPath()] ?? []),
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(setBreakpointsEffect)) return e.value;
      }
      return value;
    },
  });

  return [
    field,
    gutter({
      class: "cm-dap-gutter",
      markers: (view) => {
        const set = view.state.field(field);
        const ranges: { from: number }[] = [];
        for (let i = 1; i <= view.state.doc.lines; i++) {
          if (set.has(i)) ranges.push({ from: view.state.doc.line(i).from });
        }
        return RangeSet.of(
          ranges.map((r) => onMarker.range(r.from)),
          true,
        );
      },
      initialSpacer: () => offMarker,
      domEventHandlers: {
        mousedown: (view, block) => {
          const line = view.state.doc.lineAt(block.from).number;
          const next = new Set(view.state.field(field));
          if (next.has(line)) next.delete(line);
          else next.add(line);
          view.dispatch({ effects: setBreakpointsEffect.of(next) });
          useDapStore.getState().toggleBreakpoint(getPath(), line);
          return true;
        },
      },
    }),
    EditorView.theme({
      ".cm-dap-gutter": {
        cursor: "pointer",
        width: "1.1em",
      },
      ".cm-dap-bp": {
        display: "inline-block",
        width: "10px",
        height: "10px",
        margin: "0 4px",
        borderRadius: "9999px",
        verticalAlign: "middle",
        boxSizing: "border-box",
        border: "1px solid var(--border, rgba(255,255,255,0.15))",
      },
      ".cm-dap-bp-on": {
        background: "var(--dap-bp, #ef4444)",
        borderColor: "transparent",
      },
    }),
  ];
}
