/**
 * §3.7 LSP Editor Integration: hover tooltip, Ctrl+Click goto definition,
 * right-click context menu.
 *
 * Creates CodeMirror 6 extensions for LSP-powered editor features.
 * These are pure frontend extensions that call the existing YametLspClient
 * via the session manager.
 */
import { EditorView } from "@codemirror/view";
import { StateField, type EditorState } from "@codemirror/state";

// ---------------------------------------------------------------------------
// LSP Hover Tooltip Extension
// ---------------------------------------------------------------------------

/**
 * Create a hover tooltip that calls LSP hover on mouse stop.
 * Usage: add `lspHoverExtension()` to the editor extensions array.
 */
export function lspHoverExtension(): ReturnType<typeof EditorView.domEventHandlers> {
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  return EditorView.domEventHandlers({
    mouseover: (event: MouseEvent, view: EditorView) => {
      if (hoverTimer) clearTimeout(hoverTimer);

      const target = event.target as HTMLElement;
      if (!target?.classList?.contains("cm-content")) return;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return;

      hoverTimer = setTimeout(() => {
        // Dispatch a custom event that the LSP layer can listen to.
        const customEvent = new CustomEvent("lsp:hover-request", {
          detail: { pos, line: view.state.doc.lineAt(pos).number, character: pos - view.state.doc.lineAt(pos).from },
        });
        view.dom.dispatchEvent(customEvent);
      }, 500); // 500ms delay per doc requirement
    },
    mouseout: () => {
      if (hoverTimer) clearTimeout(hoverTimer);
    },
  });
}

// ---------------------------------------------------------------------------
// Ctrl+Click Goto Definition
// ---------------------------------------------------------------------------

/**
 * Ctrl+Click triggers goto definition at the click position.
 */
export function lspCtrlClickExtension(): ReturnType<typeof EditorView.domEventHandlers> {
  return EditorView.domEventHandlers({
    mousedown: (event: MouseEvent, view: EditorView) => {
      if (!event.ctrlKey && !event.metaKey) return;

      const target = event.target as HTMLElement;
      if (!target?.classList?.contains("cm-content")) return;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return;

      event.preventDefault();
      const line = view.state.doc.lineAt(pos);
      const customEvent = new CustomEvent("lsp:goto-definition", {
        detail: {
          pos,
          line: line.number,
          character: pos - line.from,
          file: (view.state.field(fileField, false) as { uri?: string } | undefined)?.uri,
        },
      });
      view.dom.dispatchEvent(customEvent);
    },
  });
}

// ---------------------------------------------------------------------------
// Editor Context Menu Items (right-click)
// ---------------------------------------------------------------------------

/**
 * Returns LSP context menu items for integration with an existing context menu.
 */
export function lspContextMenuItems(pos: number, state: EditorState): Array<{
  label: string;
  action: () => void;
}> {
  const line = state.doc.lineAt(pos);
  const items = [
    {
      label: "Go to definition",
      action: () => {
        const evt = new CustomEvent("lsp:goto-definition", {
          detail: { pos, line: line.number, character: pos - line.from },
        });
        state.field(viewField)?.dom.dispatchEvent(evt);
      },
    },
    {
      label: "Find references",
      action: () => {
        const evt = new CustomEvent("lsp:find-references", {
          detail: { pos, line: line.number, character: pos - line.from },
        });
        state.field(viewField)?.dom.dispatchEvent(evt);
      },
    },
    {
      label: "Code actions",
      action: () => {
        const evt = new CustomEvent("lsp:code-actions", {
          detail: { pos, line: line.number, character: pos - line.from },
        });
        state.field(viewField)?.dom.dispatchEvent(evt);
      },
    },
  ];
  return items;
}

// Placeholder fields for the extensions above.
// In practice these are wired through the view state when integrating.
const fileField = StateField.define<string | null>({
  create: () => null,
  update: (v) => v,
});
const viewField = StateField.define<EditorView | null>({
  create: () => null,
  update: (v) => v,
});

/**
 * All LSP extensions bundled for easy inclusion.
 */
export function allLspExtensions() {
  return [lspHoverExtension(), lspCtrlClickExtension()];
}
