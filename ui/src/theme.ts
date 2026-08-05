export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "claude-oversee-theme";
const ORDER: ThemePref[] = ["system", "light", "dark"];

export function getThemePref(): ThemePref {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function applyThemePref(pref: ThemePref) {
  if (pref === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = pref;
  }
}

export function cycleThemePref(): ThemePref {
  const next = ORDER[(ORDER.indexOf(getThemePref()) + 1) % ORDER.length];
  if (next === "system") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, next);
  applyThemePref(next);
  return next;
}

export const themeLabel = (pref: ThemePref): string =>
  pref === "system" ? "◐ auto" : pref === "light" ? "☀ light" : "☾ dark";
