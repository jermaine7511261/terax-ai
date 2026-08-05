import { tStatic, useI18n } from "@/lib/i18n";
import { Alert02Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};

type Props = {
  url: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
};

// Tear the iframe down after this much invisibility — a background dev
// server page can hold hundreds of MB inside the WebView.
const SUSPEND_AFTER_MS = 30_000;

/** Classify a preview URL by what should render it: a web page, an image, or a PDF. */
export function previewKindFromUrl(url: string): "web" | "image" | "pdf" {
  if (!url) return "web";
  // Strip a possible query/hash fragment before checking the extension.
  const clean = url.split(/[?#]/)[0];
  const lower = clean.toLowerCase();
  if (/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/.test(lower)) return "image";
  if (/\.pdf$/.test(lower)) return "pdf";
  return "web";
}

export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ url, visible, onUrlChange }, ref) {
    const { t } = useI18n();
    // `nonce` is part of the iframe `key`. Bumping it remounts the iframe,
    // which is the only reliable cross-origin reload (calling
    // contentWindow.location.reload() throws on cross-origin frames).
    const [nonce, setNonce] = useState(0);
    const [loaded, setLoaded] = useState(visible);
    const [zoom, setZoom] = useState(1);
    const addressRef = useRef<PreviewAddressBarHandle>(null);

    useEffect(() => {
      if (visible) {
        setLoaded(true);
        return;
      }
      const t = setTimeout(() => setLoaded(false), SUSPEND_AFTER_MS);
      return () => clearTimeout(t);
    }, [visible]);

    // Reset zoom when the previewed file changes.
    useEffect(() => {
      setZoom(1);
    }, [url]);

    useImperativeHandle(
      ref,
      () => ({
        reload: () => {
          setLoaded(true);
          setNonce((n) => n + 1);
        },
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => url,
      }),
      [url],
    );

    const kind = previewKindFromUrl(url);
    const isEmbeddedFile = kind === "image" || kind === "pdf";
    const showXfoHint = url && !isLocalUrl(url) && !isEmbeddedFile;

    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <PreviewAddressBar
          ref={addressRef}
          url={url}
          onSubmit={onUrlChange}
          onReload={() => setNonce((n) => n + 1)}
        />
        {showXfoHint ? (
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 bg-amber-500/8 px-3 text-[11px] text-amber-600 dark:text-amber-400">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={12}
              strokeWidth={1.75}
              className="shrink-0"
            />
            <span className="truncate">
              Many public sites refuse to embed (X-Frame-Options). If the page
              is blank, open it externally.
            </span>
          </div>
        ) : null}
        <div
          className={
            url
              ? "relative min-h-0 flex-1 bg-white"
              : "relative min-h-0 flex-1 bg-background"
          }
        >
          {url ? (
            kind === "image" ? (
              <FilePreviewHeader
                label={t("preview.image")}
                onOpenExternal={() => window.open(url, "_blank")}
                zoom={zoom}
                onZoomChange={setZoom}
              >
                <img
                  key={url}
                  src={url}
                  alt=""
                  style={{ transform: `scale(${zoom})` }}
                  className="mx-auto origin-center object-contain"
                />
              </FilePreviewHeader>
            ) : kind === "pdf" ? (
              <FilePreviewHeader
                label={t("preview.pdf")}
                onOpenExternal={() => window.open(url, "_blank")}
              >
                <embed
                  key={url}
                  src={url}
                  type="application/pdf"
                  className="h-full w-full"
                />
              </FilePreviewHeader>
            ) : loaded ? (
              <iframe
                key={`${url}#${nonce}`}
                src={url}
                title={tStatic("preview.preview")}
                className="h-full w-full border-0"
                // sandbox grants the bare minimum for a dev preview: scripts,
                // same-origin (cookies/storage for the previewed app), forms,
                // popups for "open in new tab". Critically OMITS
                // `allow-top-navigation*` — without it the iframe cannot
                // navigate the parent Tauri webview to an attacker origin,
                // which would otherwise expose `window.__TAURI__` IPC.
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
                referrerPolicy="no-referrer"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            ) : (
              <SuspendedState
                onReload={() => {
                  setLoaded(true);
                  setNonce((n) => n + 1);
                }}
              />
            )
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    );
  },
);

function SuspendedState({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={18} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium text-foreground">
          Preview suspended
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
          Released to free memory after sitting in the background.
        </p>
      </div>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md border border-border/60 bg-card px-3 py-1 text-[11px] hover:bg-accent/50"
      >
        Reload
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          Nothing to preview yet
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Type a URL above, or open the{" "}
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">
            Ports
          </span>{" "}
          dropdown to jump straight to your running dev server. Public sites
          often block embedding — open them in your browser via the link icon if
          you see a blank page.
        </p>
      </div>
    </div>
  );
}

/** Header + scrollable body for image/PDF file previews (not iframe-sandboxed). */
function FilePreviewHeader({
  label,
  onOpenExternal,
  zoom = 1,
  onZoomChange,
  children,
}: {
  label: string;
  onOpenExternal: () => void;
  zoom?: number;
  onZoomChange?: (z: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 bg-card/60 px-3">
        <span className="truncate text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {onZoomChange ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                title={tStatic("preview.zoomOut")}
              >
                −
              </button>
              <span className="min-w-8 text-center font-mono text-[10.5px] text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => onZoomChange(Math.min(4, zoom + 0.25))}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                title={tStatic("preview.zoomIn")}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => onZoomChange(1)}
                className="ml-1 text-[10.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                title={tStatic("preview.resetZoom")}
              >
                {tStatic("preview.resetZoom")}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onOpenExternal}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {tStatic("preview.openExternal")}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white">{children}</div>
    </div>
  );
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h === "[::1]" ||
      h.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
