import { useState } from "react";
import { cycleThemePref, getThemePref, themeLabel } from "../theme";

export function ThemeToggle() {
  const [pref, setPref] = useState(getThemePref());
  return (
    <button
      className="theme-toggle"
      title="Theme: auto → light → dark"
      onClick={() => setPref(cycleThemePref())}
    >
      {themeLabel(pref)}
    </button>
  );
}
