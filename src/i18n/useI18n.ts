import { useState, useEffect, useCallback } from "react";
import { t, setLocale, getLocale, onLocaleChange, offLocaleChange, notifyLocaleChange, type Locale } from "./i18n";

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  useEffect(() => {
    const handler = () => setLocaleState(getLocale());
    onLocaleChange(handler);
    return () => offLocaleChange(handler);
  }, []);

  const changeLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    notifyLocaleChange();
    setLocaleState(newLocale);
  }, []);

  return { t, locale, setLocale: changeLocale };
}
