import { useI18n } from "@/lib/i18n";
import { native } from "@/modules/ai/lib/native";
import { poolSlotStats } from "@/modules/terminal/lib/rendererPool";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useEffect, useState } from "react";

type ResourceStats = { cpuPercent: number; memoryMb: number; uptimeSecs: number };

const POLL_MS = 3000;

/**
 * Runtime resource indicator for the status bar: process CPU% + memory from
 * the Rust `resource_stats` command, and GPU usage surfaced as the count of
 * live WebGL contexts (the terminal renders on the GPU via WebGL by default).
 * The tooltip explains what each number means.
 */
export function ResourceStatsIndicator() {
  const { t } = useI18n();
  const [stats, setStats] = useState<ResourceStats | null>(null);
  const [webglSlots, setWebglSlots] = useState(0);
  // Re-read WebGL count reactively so hidden/parked slots update the number.
  const sessionId = useChatStore((s) => s.activeSessionId);
  void sessionId;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await native.resourceStats();
        if (!alive) return;
        setStats(s);
        setWebglSlots(poolSlotStats().filter((slot) => slot.webgl).length);
      } catch {
        if (alive) setStats(null);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (!stats) return null;

  const cpu = stats.cpuPercent.toFixed(0);
  const mem = stats.memoryMb.toFixed(0);
  const gpuActive = webglSlots > 0;

  return (
    <span
      className="flex shrink-0 items-center gap-2 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/80"
      title={t("statusbar.resourceTooltip")}
    >
      <span
        className="inline-flex items-center gap-1"
        data-testid="res-cpu"
        title="CPU"
      >
        {cpu}%
      </span>
      <span
        className="inline-flex items-center gap-1"
        data-testid="res-mem"
        title="Memory"
      >
        {mem}MB
      </span>
      <span
        className={gpuActive ? "text-primary" : "text-muted-foreground/50"}
        data-testid="res-gpu"
        title={gpuActive ? `${webglSlots} WebGL context(s)` : "GPU idle"}
      >
        GPU
      </span>
    </span>
  );
}
