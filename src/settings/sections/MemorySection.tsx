import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  MEMORY_PROVIDERS,
  setAutoCompress,
  setCompressTarget,
  setCompressThreshold,
  setContextEngine,
  setMemoryProvider,
  setPersistentMemory,
  setProtectRecent,
  setUserProfile,
  USER_PROFILE_CHAR_LIMIT,
  type ContextEngine,
  type MemoryProvider,
} from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

export function MemorySection() {
  const { t } = useI18n();
  const persistentMemory = usePreferencesStore((s) => s.persistentMemory);
  const userProfile = usePreferencesStore((s) => s.userProfile);
  const memoryProvider = usePreferencesStore((s) => s.memoryProvider);
  const contextEngine = usePreferencesStore((s) => s.contextEngine);
  const autoCompress = usePreferencesStore((s) => s.autoCompress);
  const compressThreshold = usePreferencesStore((s) => s.compressThreshold);
  const compressTarget = usePreferencesStore((s) => s.compressTarget);
  const protectRecent = usePreferencesStore((s) => s.protectRecent);

  const providerDisabled = !persistentMemory;
  const engineOptions: { id: ContextEngine; label: string; hint: string }[] = [
    { id: "recall", label: t("settingsMemory.engineRecall"), hint: "" },
    { id: "full", label: t("settingsMemory.engineFull"), hint: "" },
    { id: "native", label: t("settingsMemory.engineNative"), hint: "" },
    { id: "off", label: t("settingsMemory.engineOff"), hint: "" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title={t("settingsMemory.memory")}
        description={t("settingsMemory.description")}
      />

      <div className="flex flex-col gap-2">
        <SettingRow
          title={t("settingsMemory.persistentMemory")}
          description={t("settingsMemory.persistentMemoryHint")}
        >
          <Switch
            checked={persistentMemory}
            onCheckedChange={(v) => void setPersistentMemory(v)}
          />
        </SettingRow>

        <SettingRow
          title={t("settingsMemory.userProfile")}
          description={t("settingsMemory.userProfileHint")}
          className="items-start"
        >
          <div className="flex w-72 flex-col gap-1">
            <Textarea
              value={userProfile}
              onChange={(e) => void setUserProfile(e.target.value)}
              placeholder={t("settingsMemory.userProfilePlaceholder")}
              disabled={!persistentMemory}
              className="min-h-24 resize-y text-[11.5px] leading-relaxed"
            />
            <span
              className={cn(
                "text-right text-[9.5px] tabular-nums",
                userProfile.length >= USER_PROFILE_CHAR_LIMIT
                  ? "text-destructive"
                  : "text-muted-foreground/70",
              )}
            >
              {userProfile.length} / {USER_PROFILE_CHAR_LIMIT}
            </span>
          </div>
        </SettingRow>

        <SettingRow
          title={t("settingsMemory.memoryProvider")}
          description={t("settingsMemory.memoryProviderHint")}
        >
          <ProviderPicker
            value={memoryProvider}
            disabled={providerDisabled}
            onChange={(v) => void setMemoryProvider(v)}
          />
        </SettingRow>

        <SettingRow
          title={t("settingsMemory.contextEngine")}
          description={
            memoryProvider !== "native"
              ? t("settingsMemory.contextEngineHintFile")
              : t("settingsMemory.contextEngineHintNative")
          }
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={providerDisabled}
                className="h-8 w-40 justify-between gap-2 px-2.5 text-[11.5px]"
              >
                <span className="truncate">
                  {engineOptions.find((o) => o.id === contextEngine)?.label ??
                    contextEngine}
                </span>
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={11}
                  strokeWidth={2}
                  className="opacity-70"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52 p-1">
              {engineOptions.map((o) => (
                <DropdownMenuItem
                  key={o.id}
                  disabled={o.id === "native" && memoryProvider !== "native"}
                  onSelect={() => void setContextEngine(o.id)}
                  className={cn(
                    "flex items-center gap-2 text-[12px]",
                    o.id === contextEngine && "bg-accent/50",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingRow>

        <SettingRow
          title={t("settingsMemory.autoCompress")}
          description={t("settingsMemory.autoCompressHint")}
        >
          <Switch
            checked={autoCompress}
            onCheckedChange={(v) => void setAutoCompress(v)}
          />
        </SettingRow>

        <SettingRow
          title={t("settingsMemory.compressThreshold")}
          description={t("settingsMemory.compressThresholdHint")}
        >
          <NumberField
            value={compressThreshold}
            min={0.05}
            max={0.95}
            step={0.05}
            disabled={!autoCompress}
            onCommit={(v) => void setCompressThreshold(v)}
          />
        </SettingRow>

        <SettingRow
          title={t("settingsMemory.compressTarget")}
          description={t("settingsMemory.compressTargetHint")}
        >
          <div className="flex items-center gap-1.5">
            <NumberField
              value={compressTarget}
              min={0.05}
              max={0.9}
              step={0.05}
              disabled={!autoCompress}
              onCommit={(v) => void setCompressTarget(v)}
            />
            <span className="text-[10.5px] text-muted-foreground">%</span>
          </div>
        </SettingRow>

        <SettingRow
          title={t("settingsMemory.protectRecent")}
          description={t("settingsMemory.protectRecentHint")}
        >
          <NumberField
            value={protectRecent}
            min={0}
            max={100}
            disabled={!autoCompress}
            onCommit={(v) => void setProtectRecent(v)}
          />
        </SettingRow>
      </div>
    </div>
  );
}

function ProviderPicker({
  value,
  disabled,
  onChange,
}: {
  value: MemoryProvider;
  disabled: boolean;
  onChange: (v: MemoryProvider) => void;
}) {
  const { t } = useI18n();
  const labels: Record<MemoryProvider, string> = {
    file: t("settingsMemory.providerFile"),
    native: t("settingsMemory.providerNative"),
    session: t("settingsMemory.providerSession"),
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="h-8 w-40 justify-between gap-2 px-2.5 text-[11.5px]"
        >
          <span className="truncate">{labels[value]}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52 p-1">
        {MEMORY_PROVIDERS.map((p) => (
          <DropdownMenuItem
            key={p}
            onSelect={() => onChange(p)}
            className={cn(
              "flex items-center gap-2 text-[12px]",
              p === value && "bg-accent/50",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{labels[p]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NumberField({
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step ?? 1}
      disabled={disabled}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onCommit(v);
        else e.target.value = String(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const v = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) onCommit(v);
        }
      }}
      className="h-8 w-20 font-mono text-[11.5px]"
    />
  );
}
