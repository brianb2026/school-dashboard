/** Six looks, or follow the Mac (Light by day, Dark by night). Remembered in this browser only. */
export type Theme = "auto" | "light" | "dark" | "paper" | "sage" | "midnight" | "mocha";

/** Name, one line, and the colors for its little preview (background, card, accent). */
export const THEMES: { id: Theme; name: string; note: string; preview: [string, string, string] }[] = [
  { id: "auto", name: "Match my Mac", note: "Light or Dark with your Mac", preview: ["#f8f7fc", "#15181d", "#7fa7c9"] },
  { id: "light", name: "Light", note: "airy, soft pastels", preview: ["#f8f7fc", "#ffffff", "#5a6fbd"] },
  { id: "paper", name: "Paper", note: "warm cream, terracotta", preview: ["#f6f1e8", "#fffdf8", "#a9583a"] },
  { id: "sage", name: "Sage", note: "pale green, calm", preview: ["#f2f6f2", "#ffffff", "#3a7a63"] },
  { id: "dark", name: "Dark", note: "slate, cool blue", preview: ["#15181d", "#1c2027", "#7fa7c9"] },
  { id: "midnight", name: "Midnight", note: "deep navy, periwinkle", preview: ["#0e1220", "#151a2b", "#93a6ff"] },
  { id: "mocha", name: "Mocha", note: "warm brown, amber", preview: ["#19140f", "#221b16", "#e2aa6c"] },
];
const KEY = "sd-theme";

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.some((x) => x.id === t) ? (t as Theme) : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(t: Theme): void {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try {
    if (t === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* private window: the choice lasts until the page closes */
  }
}
