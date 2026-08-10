import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { native } from "@/modules/ai/lib/native";

type UserPrefs = {
  editorStyle?: string | null;
  shellPreference?: string | null;
  commonTools: string[];
  responseStyle?: string | null;
  extractedAt?: string | null;
};

/** R30 §2.3: read-only view of the cross-session user preferences extracted
 *  from completed agent runs (Rust `preferences.json`). */
export function UserPreferencesPanel() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);

  useEffect(() => {
    let alive = true;
    void native
      .preferencesGet()
      .then((p) => {
        if (alive) setPrefs(p);
      })
      .catch(() => {
        if (alive) setPrefs(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!prefs) {
    return (
      <p className="text-xs text-foreground/60">
        {t("settingsModels.noPreferences")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-foreground/80">
      <div>
        {t("settingsModels.editorStyle")}: {prefs.editorStyle ?? "—"}
      </div>
      <div>
        {t("settingsModels.shellPreference")}: {prefs.shellPreference ?? "—"}
      </div>
      <div>
        {t("settingsModels.responseStyle")}: {prefs.responseStyle ?? "—"}
      </div>
      <div>
        {t("settingsModels.commonTools")}:{" "}
        {prefs.commonTools?.length
          ? prefs.commonTools.join(", ")
          : "—"}
      </div>
    </div>
  );
}