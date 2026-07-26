import { useState, useEffect, useRef } from "react";

type Props = {
  definition: string;
  className?: string;
};

const THEME_STYLES = {
  background: "transparent",
  primaryColor: "#3b82f6",
  primaryTextColor: "#1e293b",
  primaryBorderColor: "#93c5fd",
  lineColor: "#64748b",
  secondaryColor: "#f1f5f9",
  tertiaryColor: "#e2e8f0",
  fontFamily: "system-ui, sans-serif",
};

/**
 * Renders Mermaid diagrams in markdown preview.
 * Uses the mermaid library for client-side rendering.
 * Falls back to a text placeholder if mermaid is not loaded.
 */
export function MermaidPreview({ definition, className = "" }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = await loadMermaid();
        if (cancelled) return;
        setLoaded(true);

        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: THEME_STYLES,
          flowchart: { useMaxWidth: true, htmlLabels: true },
          sequence: { useMaxWidth: true },
          gantt: { useMaxWidth: true },
        });

        const id = `mermaid-${Date.now().toString(36)}`;
        const { svg: rendered } = await mermaid.render(id, definition);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setSvg(null);
        }
      }
    }

    if (definition.trim()) {
      render();
    }

    return () => { cancelled = true; };
  }, [definition]);

  if (error) {
    return (
      <div className={`p-3 bg-red-50 border border-red-200 rounded text-sm ${className}`}>
        <p className="text-red-600 font-medium mb-1">Mermaid render error</p>
        <pre className="text-red-500 text-xs whitespace-pre-wrap">{error}</pre>
        <details className="mt-2">
          <summary className="text-xs text-gray-500 cursor-pointer">Raw definition</summary>
          <pre className="text-xs text-gray-600 mt-1 bg-white p-2 rounded whitespace-pre-wrap">
            {definition}
          </pre>
        </details>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className={`p-4 bg-gray-50 border rounded text-sm ${className}`}>
        <p className="text-gray-400 text-xs mb-2">Loading Mermaid...</p>
        <pre className="text-xs text-gray-500 whitespace-pre-wrap">{definition}</pre>
      </div>
    );
  }

  if (svg) {
    return (
      <div
        ref={containerRef}
        className={`mermaid-container overflow-auto p-2 ${className}`}
        dangerouslySetInnerHTML={{ __html: svg }}
        style={{ minHeight: 60 }}
      />
    );
  }

  return (
    <pre className={`text-xs bg-gray-50 p-2 rounded whitespace-pre-wrap ${className}`}>
      {definition}
    </pre>
  );
}

let mermaidModule: any = null;

async function loadMermaid(): Promise<any> {
  if (!mermaidModule) {
    try {
      mermaidModule = await import("mermaid");
    } catch {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Mermaid from CDN"));
        document.head.appendChild(script);
      });
      mermaidModule = await import("mermaid");
    }
  }
  return mermaidModule.default || mermaidModule;
}
