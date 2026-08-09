import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useUpdater } from "@/modules/updater";
import { getAppName, getAppVersion } from "@/platform";
import { getOsArch, getOsPlatform } from "@/platform";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const PLATFORM_LABEL: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
  freebsd: "FreeBSD",
};

export function AboutSection() {
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const [name, setName] = useState("YaMet");
  const [build, setBuild] = useState("");
  const { status, check, install } = useUpdater({ autoCheck: false });
  const checking = status.kind === "checking";
  const downloading = status.kind === "downloading";
  const available = status.kind === "available";
  const manualAvailable = status.kind === "manual-available";
  const ready = status.kind === "ready";
  const checkLabel =
    status.kind === "uptodate"
      ? t("updater.youAreUpToDate")
      : status.kind === "error"
        ? t("updater.checkFailed")
        : checking
          ? t("updater.checking")
          : downloading
            ? t("updater.downloading")
            : ready
              ? t("updater.restartToInstall")
              : available
                ? t("updater.install", { version: status.update.version })
                : manualAvailable
                  ? t("updater.updateTo", { version: status.info.version })
                  : t("updater.checkForUpdates");
  const onUpdateClick = () => {
    if (available) void install();
    else void check({ manual: true });
  };

  useEffect(() => {
    void getAppVersion().then(setVersion);
    void getAppName().then(setName);
    try {
      const p = getOsPlatform();
      const a = getOsArch();
      const platformLabel = PLATFORM_LABEL[p] ?? p;
      setBuild(`${platformLabel} · ${a}`);
    } catch {
      setBuild("");
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t("settingsAbout.about")} description="" />

      <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-card/60 p-5">
        <img src="/logo.png" alt="" className="size-12" draggable={false} />
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold tracking-tight">
            {name}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t("settingsAbout.openSource")}
          </span>
          <span className="mt-1 font-mono text-[11px] text-muted-foreground">
            v{version || "—"}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 text-[12px]">
        <dt className="text-muted-foreground">{t("settingsAbout.build")}</dt>
        <dd className="font-mono text-[11.5px]">
          {build ? `${build} · v${version}` : `v${version}`}
        </dd>

        <dt className="text-muted-foreground">
          {t("settingsAbout.bundleId")}
        </dt>
        <dd className="font-mono text-[11.5px]">app.yamet.yamet</dd>

        <dt className="text-muted-foreground">{t("settingsAbout.license")}</dt>
        <dd>Apache 2.0</dd>
      </dl>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onUpdateClick}
            disabled={checking || downloading || ready}
          >
            {checkLabel}
          </Button>
        </div>
        {status.kind === "error" && (
          <p className="font-mono text-[10.5px] break-all text-destructive/80">
            {status.message}
          </p>
        )}
        {downloading && status.contentLength ? (
          <p className="text-[11px] text-muted-foreground">
            {Math.min(
              100,
              Math.round((status.downloaded / status.contentLength) * 100),
            )}
            %
          </p>
        ) : null}
      </div>
    </div>
  );
}
