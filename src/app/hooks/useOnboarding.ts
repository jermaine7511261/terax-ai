import { useCallback, useEffect, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setHasOnboarded } from "@/modules/settings/store";

/**
 * First-run welcome dialog: open once prefs have hydrated and the user hasn't
 * dismissed it before, persist via setHasOnboarded so it never reappears.
 */
export function useOnboarding() {
  const [open, setOpen] = useState(false);
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const hasOnboarded = usePreferencesStore((s) => s.hasOnboarded);

  useEffect(() => {
    if (!prefsHydrated || hasOnboarded) return;
    const t = setTimeout(() => setOpen(true), 400);
    return () => clearTimeout(t);
  }, [prefsHydrated, hasOnboarded]);

  const complete = useCallback(() => {
    setOpen(false);
    void setHasOnboarded();
  }, []);

  return { open, complete, setOpen };
}
