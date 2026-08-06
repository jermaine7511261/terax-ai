import { useI18n } from "@/lib/i18n";
import { DapAdaptersGroup } from "@/modules/dap";
import { McpServersGroup } from "@/modules/mcp";
import { SectionHeader } from "../components/SectionHeader";

export function IntegrationsSection() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title={t("settings.integrations")}
        description={t("settingsDap.description")}
      />
      <McpServersGroup />
      <DapAdaptersGroup />
    </div>
  );
}
