import { useEffect, useState } from "react";
import { listen } from "@/platform";
import {
  isNotificationGranted,
  requestNotificationPermission,
  sendNotification,
} from "@/platform";
import { firePendingReviewForSession } from "@/modules/agents/lib/review";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import {
  getAllCustomEndpointKeys,
  getAllKeys,
  hasAnyKey,
} from "../lib/keyring";
import { useAgentsStore } from "../store/agentsStore";
import { useChatStore } from "../store/chatStore";
import { useSnippetsStore } from "../store/snippetsStore";
import { scanSkillsDir } from "../lib/skills";
import { runBackgroundCurator } from "../lib/skillCuratorRunner";
import { createStorage } from "@/platform";
import type { FiredTask } from "../lib/scheduler";

const curatorStore = createStorage("YaMet-ai-skill-curator.json");

/**
 * Startup wiring for the AI subsystem: loads provider keys (and keeps them in
 * sync), hydrates the preference store and mirrors the default model, hydrates
 * chat/agents/snippets stores, and fires any pending review for the active
 * session. Returns the two derived flags the shell needs.
 */
export function useAiBootstrap(): {
  hasComposer: boolean;
  keysLoaded: boolean;
} {
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setApiKeys = useChatStore((s) => s.setApiKeys);
  const setCustomEndpointKeys = useChatStore((s) => s.setCustomEndpointKeys);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const hydrateSessions = useChatStore((s) => s.hydrateSessions);

  useEffect(() => {
    if (activeSessionId) firePendingReviewForSession(activeSessionId);
  }, [activeSessionId]);

  const llamaCppModelId = usePreferencesStore((s) => s.llamaCppModelId);
  const llamaCppBaseURL = usePreferencesStore((s) => s.llamaCppBaseURL);
  const openaiCompatibleModelId = usePreferencesStore(
    (s) => s.openaiCompatibleModelId,
  );
  const openaiCompatibleBaseURL = usePreferencesStore(
    (s) => s.openaiCompatibleBaseURL,
  );
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const hasLocalModel =
    (llamaCppBaseURL.trim().length > 0 &&
      llamaCppModelId.trim().length > 0) ||
    (openaiCompatibleBaseURL.trim().length > 0 &&
      openaiCompatibleModelId.trim().length > 0) ||
    customEndpoints.some(
      (e) => e.baseURL.trim().length > 0 && e.modelId.trim().length > 0,
    );
  const hasComposer = hasAnyKey(apiKeys) || hasLocalModel;

  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const [keysLoaded, setKeysLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const reload = () => {
      void getAllKeys().then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setKeysLoaded(true);
      });
      if (!prefsHydrated) return;
      void getAllCustomEndpointKeys(
        usePreferencesStore.getState().customEndpoints,
      ).then((epKeys) => {
        if (!alive) return;
        setCustomEndpointKeys(epKeys);
      });
    };
    reload();
    const unlistenP = onKeysChanged(reload);
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, [setApiKeys, setCustomEndpointKeys, prefsHydrated]);

  // Hydrate the cross-window preference store and mirror the default model
  // into chatStore so the dropdown reflects what the user picked in Settings.
  const initPrefs = usePreferencesStore((s) => s.init);
  const prefDefaultModel = usePreferencesStore((s) => s.defaultModelId);
  useEffect(() => {
    void initPrefs();
  }, [initPrefs]);
  useEffect(() => {
    if (!prefsHydrated) return;
    setSelectedModelId(prefDefaultModel);
  }, [prefsHydrated, prefDefaultModel, setSelectedModelId]);

  useEffect(() => {
    void hydrateSessions();
    void useAgentsStore.getState().hydrate();
    // Scan the workspace `skills/` directory once at boot (★ L4):
    // builtins merge into the snippet store as `builtin: true` snippets and
    // honor the user's disabled set. hydrate() must settle first — merging
    // builtins before it resolves lets its set({snippets}) overwrite them.
    void (async () => {
      await useSnippetsStore.getState().hydrate();
      const root = useChatStore.getState().live.getWorkspaceRoot() ?? null;
      const builtins = await scanSkillsDir(root);
      if (builtins.length > 0) {
        useSnippetsStore.getState().mergeBuiltin(builtins);
      }
      // P1-5 background skill curator (inactivity-triggered): run at most once
      // per hour; archives stale agent-created skills (non-destructive).
      const lastRunAt = (await curatorStore.get<number>("lastRunAt")) ?? 0;
      await runBackgroundCurator(root, {
        lastRunAt,
        setLastRunAt: (t) => void curatorStore.set("lastRunAt", t),
      });
    })();
  }, [hydrateSessions]);

  // Cron scheduler fires (★ H3): spawn the agent for session targets,
  // otherwise send a system notification.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<FiredTask>("yamet:scheduler-fire", (e) => {
      const fired = e.payload;
      const live = useChatStore.getState().live;
      if (fired.target === "session") {
        const sessionId = useChatStore.getState().activeSessionId;
        if (sessionId) {
          live.spawnManagedAgent(fired.prompt, sessionId);
        }
      } else {
        void (async () => {
          let granted = await isNotificationGranted();
          if (!granted) {
            granted = await requestNotificationPermission();
          }
          if (granted) {
            sendNotification({
              title: `YaMet · ${fired.name}`,
              body: fired.prompt.slice(0, 120),
            });
          }
        })();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return { hasComposer, keysLoaded };
}
