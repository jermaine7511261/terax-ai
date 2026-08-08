import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ThemePref } from "@/modules/settings/store";
import {
  setAgentNotifications,
  setAutostart,
  setDefaultWorkspaceEnv,
  setExplorerGitDecorations,
  setLanguage,
  setRestoreWindowState,
  setShowHidden,
  setTerminalCursorBlink,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalFontWeight,
  setTerminalLetterSpacing,
  setTerminalScrollback,
  setTerminalShell,
  setTerminalWebglEnabled,
  setZoomLevel,
  setWorkspaceRoot,
  TERMINAL_FONT_SIZES,
  TERMINAL_SCROLLBACK_PRESETS,
} from "@/modules/settings/store";
import { useTheme } from "@/modules/theme";
import { openDialog } from "@/platform";
import {
  ComputerIcon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@/platform";
import { autostartDisable, autostartEnable, autostartIsEnabled } from "@/platform";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

const APPEARANCE: { id: ThemePref; icon: typeof ComputerIcon }[] = [
  { id: "system", icon: ComputerIcon },
  { id: "light", icon: Sun03Icon },
  { id: "dark", icon: Moon02Icon },
];

const TERMINAL_FONT_WEIGHTS = ["normal", "500", "600", "bold"] as const;
const LETTER_SPACINGS = [-4, -3, -2, -1, 0, 1, 2, 3, 4] as const;

type ShellInfo = { name: string; path: string; integrated: boolean };
const SHELL_AUTO = "auto";
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.05;

export function GeneralSection() {
  const { t } = useI18n();
  const { mode, setMode } = useTheme();

  const language = usePreferencesStore((s) => s.language);
  const autostart = usePreferencesStore((s) => s.autostart);
  const restoreWindowState = usePreferencesStore((s) => s.restoreWindowState);
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );
  const terminalWebglEnabled = usePreferencesStore(
    (s) => s.terminalWebglEnabled,
  );
  const terminalCursorBlink = usePreferencesStore((s) => s.terminalCursorBlink);
  const terminalFontFamily = usePreferencesStore((s) => s.terminalFontFamily);
  const terminalFontWeight = usePreferencesStore((s) => s.terminalFontWeight);
  const terminalShell = usePreferencesStore((s) => s.terminalShell);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [wslDistros, setWslDistros] = useState<{ name: string }[]>([]);
  const defaultWorkspaceEnv = usePreferencesStore((s) => s.defaultWorkspaceEnv);
  const terminalLetterSpacing = usePreferencesStore(
    (s) => s.terminalLetterSpacing,
  );
  const terminalFontSize = usePreferencesStore((s) => s.terminalFontSize);
  const terminalScrollback = usePreferencesStore((s) => s.terminalScrollback);
  const zoomLevel = usePreferencesStore((s) => s.zoomLevel);
  const agentNotifications = usePreferencesStore((s) => s.agentNotifications);
  const workspaceRoot = usePreferencesStore((s) => s.workspaceRoot);

  useEffect(() => {
    let alive = true;
    void autostartIsEnabled()
      .then((on) => {
        if (!alive) return;
        if (on !== usePreferencesStore.getState().autostart) {
          void setAutostart(on);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void invoke<ShellInfo[]>("pty_list_shells")
      .then(setShells)
      .catch(() => {});
    void invoke<{ name: string }[]>("wsl_list_distros")
      .then(setWslDistros)
      .catch(() => {});
  }, []);

  const onToggleAutostart = async (next: boolean) => {
    try {
      if (next) await autostartEnable();
      else await autostartDisable();
      await setAutostart(next);
    } catch (e) {
      console.error("autostart toggle failed", e);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("settings.general")}
        description={t("settingsGeneral.themeDescription")}
      />

      <SettingRow
        title={t("settingsGeneral.languageLabel")}
        description={t("settingsGeneral.languageDescription")}
      >
        <Select
          value={language}
          onValueChange={(v) => void setLanguage(v as "zh" | "en")}
        >
          <SelectTrigger value={language} className="h-8 w-40 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh" className="text-[12px]">
              中文（简体）
            </SelectItem>
            <SelectItem value="en" className="text-[12px]">
              English
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <div className="flex flex-col gap-2">
        <Label>{t("settingsGeneral.appearance")}</Label>
        <div className="grid grid-cols-3 gap-2">
          {APPEARANCE.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id)}
              className={cn(
                "group flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border bg-card transition-all",
                mode === o.id
                  ? "border-foreground/60 ring-1 ring-foreground/20"
                  : "border-border/60 hover:border-border",
              )}
            >
              <HugeiconsIcon icon={o.icon} size={18} strokeWidth={1.5} />
              <span className="text-[11.5px]">{t(`common.${o.id}`)}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("settingsGeneral.themeTabHint")}{" "}
          <strong className="font-medium text-foreground">
            {t("settingsGeneral.themesTab")}
          </strong>{" "}
          {t("settingsGeneral.tabWord")}.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settingsGeneral.zoom")}</Label>
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-muted-foreground">
              {t("settingsGeneral.uiZoomLevel")}
            </span>
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {t("settingsGeneral.zoomPercent", {
                value: String(Math.round(zoomLevel * 100)),
              })}
            </span>
          </div>
          <Slider
            value={[zoomLevel]}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            onValueChange={(v) => void setZoomLevel(v[0] ?? 1)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settingsGeneral.explorerSection")}</Label>
        <SettingRow
          title={t("settingsGeneral.showHidden")}
          description={t("settingsGeneral.showHiddenDescription")}
        >
          <Switch
            checked={showHidden}
            onCheckedChange={(v) => void setShowHidden(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settingsGeneral.gitDecorations")}
          description={t("settingsGeneral.gitDecorationsDescription")}
        >
          <Switch
            checked={explorerGitDecorations}
            onCheckedChange={(v) => void setExplorerGitDecorations(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settingsGeneral.terminalSection")}</Label>
        <SettingRow
          title={
            <span className="inline-flex items-center gap-1.5">
              {t("settingsGeneral.webglRenderer")}
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="img"
                      className="cursor-help text-[11px] text-muted-foreground/70 leading-none"
                      aria-label={t("settingsGeneral.webglRenderer")}
                    >
                      ⓘ
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-65 text-[11px]">
                    {t("settingsGeneral.webglTooltip")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          }
          description={t("settingsGeneral.webglRendererDescription")}
        >
          <Switch
            checked={terminalWebglEnabled}
            onCheckedChange={(v) => void setTerminalWebglEnabled(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settingsGeneral.cursorBlink")}
          description={t("settingsGeneral.cursorBlinkDescription")}
        >
          <Switch
            checked={terminalCursorBlink}
            onCheckedChange={(v) => void setTerminalCursorBlink(v)}
          />
        </SettingRow>
        <FontFamilyInput
          value={terminalFontFamily}
          onCommit={(v) => void setTerminalFontFamily(v)}
        />
        <SettingRow
          title={t("settingsGeneral.fontWeight")}
          description={t("settingsGeneral.fontWeightDescription")}
        >
          <Select
            value={terminalFontWeight}
            onValueChange={(v) => void setTerminalFontWeight(v)}
          >
            <SelectTrigger
              value={terminalFontWeight}
              className="h-8 w-28 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_FONT_WEIGHTS.map((w) => (
                <SelectItem key={w} value={w} className="text-[12px]">
                  {t(
                    w === "normal"
                      ? "settingsGeneral.weightNormal"
                      : w === "500"
                        ? "settingsGeneral.weightMedium"
                        : w === "600"
                          ? "settingsGeneral.weightSemiBold"
                          : "settingsGeneral.weightBold",
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title={t("settingsGeneral.shell")}
          description={
            shells.find((s) => s.path === terminalShell)?.integrated === false
              ? t("settingsGeneral.shellDescriptionNotIntegrated")
              : wslDistros.length > 0
                ? t("settingsGeneral.shellDescriptionWsl")
                : t("settingsGeneral.shellDescriptionDefault")
          }
        >
          <Select
            value={terminalShell || SHELL_AUTO}
            onValueChange={(v) =>
              void setTerminalShell(v === SHELL_AUTO ? "" : v)
            }
          >
            <SelectTrigger
              value={terminalShell || SHELL_AUTO}
              className="h-8 w-40 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SHELL_AUTO} className="text-[12px]">
                {t("settingsGeneral.autoDetect")}
              </SelectItem>
              {shells.map((s) => (
                <SelectItem key={s.path} value={s.path} className="text-[12px]">
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        {(wslDistros.length > 0 || defaultWorkspaceEnv !== "local") && (
          <SettingRow
            title={t("settingsGeneral.workspaceEnv")}
            description={t("settingsGeneral.workspaceEnvDescription")}
          >
            <Select
              value={defaultWorkspaceEnv}
              onValueChange={(v) => void setDefaultWorkspaceEnv(v)}
            >
              <SelectTrigger
                value={defaultWorkspaceEnv}
                className="h-8 w-40 text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local" className="text-[12px]">
                  {t("settingsGeneral.windows")}
                </SelectItem>
                {wslDistros.map((d) => (
                  <SelectItem
                    key={d.name}
                    value={`wsl:${d.name}`}
                    className="text-[12px]"
                  >
                    WSL: {d.name}
                  </SelectItem>
                ))}
                {defaultWorkspaceEnv.startsWith("wsl:") &&
                  !wslDistros.some(
                    (d) => `wsl:${d.name}` === defaultWorkspaceEnv,
                  ) && (
                    <SelectItem
                      value={defaultWorkspaceEnv}
                      className="text-[12px]"
                    >
                      {defaultWorkspaceEnv.slice("wsl:".length)}{" "}
                      {t("settingsGeneral.unavailable")}
                    </SelectItem>
                  )}
              </SelectContent>
            </Select>
          </SettingRow>
        )}
        <SettingRow
          title={t("settingsGeneral.workspaceRoot")}
          description={t("settingsGeneral.workspaceRootDescription")}
        >
          <div className="flex items-center gap-2">
            <span className="max-w-[16rem] truncate rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
              {workspaceRoot ?? t("settingsGeneral.workspaceRootDefault")}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={() => {
                void (async () => {
                  const dir = await openDialog({
                    directory: true,
                    multiple: false,
                  });
                  if (typeof dir === "string" && dir) {
                    await setWorkspaceRoot(dir.replace(/\\/g, "/"));
                  }
                })();
              }}
            >
              {t("settingsGeneral.chooseFolder")}
            </Button>
            {workspaceRoot && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px] text-muted-foreground"
                onClick={() => void setWorkspaceRoot(null)}
              >
                {t("settingsGeneral.resetWorkspaceRoot")}
              </Button>
            )}
          </div>
          <p className="text-[10.5px] text-muted-foreground/70">
            {t("settingsGeneral.workspaceRootHint")}
          </p>
        </SettingRow>
        <SettingRow
          title={t("settingsGeneral.letterSpacing")}
          description={t("settingsGeneral.letterSpacingDescription")}
        >
          <Select
            value={String(terminalLetterSpacing)}
            onValueChange={(v) => void setTerminalLetterSpacing(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LETTER_SPACINGS.map((v) => (
                <SelectItem key={v} value={String(v)} className="text-[12px]">
                  {v > 0 ? `+${v}` : v} {t("settingsGeneral.pxUnit")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title={t("settingsGeneral.fontSize")}
          description={t("settingsGeneral.fontSizeDescription")}
        >
          <Select
            value={String(terminalFontSize)}
            onValueChange={(v) => void setTerminalFontSize(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_FONT_SIZES.map((size) => (
                <SelectItem
                  key={size}
                  value={String(size)}
                  className="text-[12px]"
                >
                  {size} {t("settingsGeneral.pxUnit")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title={t("settingsGeneral.scrollback")}
          description={t("settingsGeneral.scrollbackDescription")}
        >
          <Select
            value={String(terminalScrollback)}
            onValueChange={(v) => void setTerminalScrollback(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-36 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_SCROLLBACK_PRESETS.map((lines) => (
                <SelectItem
                  key={lines}
                  value={String(lines)}
                  className="text-[12px]"
                >
                  {lines.toLocaleString()} {t("settingsGeneral.linesUnit")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settingsGeneral.agentsSection")}</Label>
        <SettingRow
          title={t("settingsGeneral.codingAgentNotifications")}
          description={t(
            "settingsGeneral.codingAgentNotificationsDescription",
          )}
        >
          <Switch
            checked={agentNotifications}
            onCheckedChange={(v) => void setAgentNotifications(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settingsGeneral.startupSection")}</Label>
        <div className="flex flex-col gap-2">
          <SettingRow
            title={t("settingsGeneral.launchAtLogin")}
            description={t("settingsGeneral.launchAtLoginDescription")}
          >
            <Switch
              checked={autostart}
              onCheckedChange={(v) => void onToggleAutostart(v)}
            />
          </SettingRow>
          <SettingRow
            title={t("settingsGeneral.restoreWindowPosition")}
            description={t("settingsGeneral.restoreWindowPositionDescription")}
          >
            <Switch
              checked={restoreWindowState}
              onCheckedChange={(v) => void setRestoreWindowState(v)}
            />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

function FontFamilyInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Commit (and trim) only on blur/Enter so a trailing space can be typed
  // mid-edit, e.g. "JetBrains Mono ".
  const commit = () => {
    const next = draft.trim();
    if (next !== draft) setDraft(next);
    if (next !== value) onCommit(next);
  };

  return (
    <SettingRow
      title={t("settingsGeneral.fontFamily")}
      description={t("settingsGeneral.fontFamilyDescription")}
    >
      <input
        type="text"
        value={draft}
        placeholder={t("settingsGeneral.autoDetect")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus:border-foreground/40"
      />
    </SettingRow>
  );
}
