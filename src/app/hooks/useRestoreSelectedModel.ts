import { useEffect } from "react";
import { DEFAULT_MODEL_ID } from "@/modules/ai/config";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

/**
 * Restore the persisted model selection once prefs hydrate, so the chosen
 * model survives restarts. Only applies when a persisted value exists and the
 * user hasn't already picked one this session.
 */
export function useRestoreSelectedModel() {
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const prefSelectedModel = usePreferencesStore((s) => s.selectedModelId);

  useEffect(() => {
    if (!prefsHydrated) return;
    const cur = useChatStore.getState().selectedModelId;
    if (prefSelectedModel && cur === DEFAULT_MODEL_ID) {
      useChatStore.getState().setSelectedModelId(prefSelectedModel);
    }
  }, [prefsHydrated, prefSelectedModel]);
}
