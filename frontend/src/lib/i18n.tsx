import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { en, type MessageKey } from "../locales/en";
import { nl } from "../locales/nl";

export type Lang = "nl" | "en";

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "nl", label: "Nederlands" },
  { value: "en", label: "English" },
];

const messages: Record<Lang, Record<MessageKey, string>> = { en, nl };
const LOCALES: Record<Lang, string> = { nl: "nl-NL", en: "en-GB" };
const KEY = "jouleflow-lang";

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "nl" || stored === "en") return stored;
  } catch {
    /* storage unavailable */
  }
  return "nl";
}

// Module-level so plain helpers (formatters, chart options) can translate too.
// The provider remounts the app when the language changes, so everything re-renders.
let current: Lang = readLang();

type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

export function t(key: MessageKey, vars?: Vars): string {
  return interpolate(messages[current][key] ?? en[key], vars);
}

/** Translate a key built at runtime (e.g. from backend ids), falling back to `fallback`. */
export function tDynamic(key: string, fallback: string, vars?: Vars): string {
  const template = (messages[current] as Record<string, string>)[key];
  return interpolate(template ?? fallback, vars);
}

export function locale(): string {
  return LOCALES[current];
}

const I18nContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void } | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    current = next;
    setLangState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  return (
    <I18nContext.Provider value={{ lang, setLang }}>
      <div key={lang} className="contents">
        {children}
      </div>
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
