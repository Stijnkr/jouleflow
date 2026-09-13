import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeSetting = "light" | "dark" | "system";

type ThemeContextValue = {
  setting: ThemeSetting;
  resolved: "light" | "dark";
  setSetting: (s: ThemeSetting) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const KEY = "jouleflow-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>(readSetting);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const onChange = () => setSystemDark(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  const resolved = setting === "system" ? (systemDark ? "dark" : "light") : setting;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#111111" : "#f7f7f6");
  }, [resolved]);

  const setSetting = useCallback((s: ThemeSetting) => {
    setSettingState(s);
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggle = useCallback(
    () => setSetting(resolved === "dark" ? "light" : "dark"),
    [resolved, setSetting],
  );

  return (
    <ThemeContext.Provider value={{ setting, resolved, setSetting, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/** Reads the current CSS colour tokens, for use in canvas charts. */
export function readTokens() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    foreground: v("--foreground"),
    muted: v("--muted"),
    subtle: v("--subtle"),
    border: v("--border"),
    gridLine: v("--grid-line"),
    card: v("--card"),
    import: v("--import"),
    export: v("--export"),
    gas: v("--gas"),
    l1: v("--l1"),
    l2: v("--l2"),
    l3: v("--l3"),
  };
}
