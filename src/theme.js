// theme.js — Axon appearance system.
// Two interface styles (Aurora Glass, Spotlight), each with 3 color palettes,
// each palette with a dark + light theme. Everything is expressed as a flat set
// of CSS custom properties applied to <html>, so styles.css stays variable-driven.

function rgba(rgb, a) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

// ── Aurora Glass — dense liquid glass, gradient backdrops with accent blobs ──
const AURORA = {
  teal: {
    name: "Бирюза",
    blob2: [56, 132, 255],
    dark: { a: "#2dd4bf", a2: "#5eead4", aRGB: [45, 212, 191], aText: "#04201d" },
    light: { a: "#0d9488", a2: "#14b8a6", aRGB: [13, 148, 136], aText: "#ffffff" },
    bgD: ["#143b40", "#0c1f2e", "#081521"],
    bgL: ["#e6fbf6", "#eef5f8", "#f6f9fb"]
  },
  violet: {
    name: "Фиолет",
    blob2: [99, 102, 241],
    dark: { a: "#a78bfa", a2: "#c4b5fd", aRGB: [167, 139, 250], aText: "#1b0f3a" },
    light: { a: "#7c3aed", a2: "#8b5cf6", aRGB: [124, 58, 237], aText: "#ffffff" },
    bgD: ["#251c42", "#16122a", "#0f0b1d"],
    bgL: ["#f1ecfe", "#f1eef9", "#f8f6fc"]
  },
  azure: {
    name: "Лазурь",
    blob2: [34, 211, 238],
    dark: { a: "#60a5fa", a2: "#93c5fd", aRGB: [96, 165, 250], aText: "#08182e" },
    light: { a: "#2563eb", a2: "#3b82f6", aRGB: [37, 99, 235], aText: "#ffffff" },
    bgD: ["#152a4a", "#101c30", "#0a1320"],
    bgL: ["#e8f0fe", "#eef3f9", "#f6f9fc"]
  }
};

// ── Spotlight — soft warm glass, floating rounded panels ─────────────────────
const SPOTLIGHT = {
  amber: {
    name: "Янтарь",
    dark: { a: "#f59e0b", a2: "#fbbf24", aRGB: [245, 158, 11], aText: "#2a1c05" },
    light: { a: "#d97706", a2: "#f59e0b", aRGB: [217, 119, 6], aText: "#ffffff" },
    bgD: ["#2a2018", "#1a1611", "#141009"],
    bgL: ["#fff5e6", "#fdf6ec", "#faf3e8"],
    panelD: [40, 33, 24], tintD: [255, 225, 180], borderL: [180, 130, 40], shadowL: [120, 80, 20]
  },
  rose: {
    name: "Роза",
    dark: { a: "#fb7185", a2: "#fda4af", aRGB: [251, 113, 133], aText: "#2a0712" },
    light: { a: "#e11d48", a2: "#f43f5e", aRGB: [225, 29, 72], aText: "#ffffff" },
    bgD: ["#2a181d", "#1c1014", "#160b0f"],
    bgL: ["#fff0f3", "#fdf0f3", "#fbf3f5"],
    panelD: [40, 26, 30], tintD: [255, 200, 210], borderL: [180, 60, 90], shadowL: [120, 30, 50]
  },
  sky: {
    name: "Небо",
    dark: { a: "#38bdf8", a2: "#7dd3fc", aRGB: [56, 189, 248], aText: "#06222e" },
    light: { a: "#0284c7", a2: "#0ea5e9", aRGB: [2, 132, 199], aText: "#ffffff" },
    bgD: ["#15252e", "#101a20", "#0a1217"],
    bgL: ["#e8f6fd", "#eef6fb", "#f4f9fc"],
    panelD: [24, 34, 40], tintD: [180, 225, 255], borderL: [40, 120, 180], shadowL: [20, 70, 120]
  }
};

// Metadata for the Settings UI.
export const STYLES = [
  { id: "aurora", name: "Aurora Glass", desc: "Плотное liquid glass, мягкое свечение", palettes: ["teal", "violet", "azure"] },
  { id: "spotlight", name: "Spotlight", desc: "Мягкое тёплое стекло, плавающие панели", palettes: ["amber", "rose", "sky"] }
];

export const LAYOUTS = [
  { id: "classic", name: "Классический", desc: "Один сайдбар + чат — стандартный Axon" },
  { id: "chatlist", name: "Классический + список чатов", desc: "Добавляет колонку сессий слева" },
  { id: "command", name: "Command Bar", desc: "Иконочный рельс, список чатов, инспектор маршрута и расходов" }
];

export function paletteName(styleId, paletteId) {
  const set = styleId === "spotlight" ? SPOTLIGHT : AURORA;
  return set[paletteId]?.name || paletteId;
}

export function defaultPaletteFor(styleId) {
  return styleId === "spotlight" ? "amber" : "teal";
}

// Build the flat CSS-variable map for a (style, palette, theme) combination.
export function buildThemeVars(styleId, paletteId, theme) {
  const dark = theme === "dark";
  const style = styleId === "spotlight" ? "spotlight" : "aurora";

  if (style === "aurora") {
    const set = AURORA[paletteId] ? paletteId : "teal";
    const P = AURORA[set];
    const A = dark ? P.dark : P.light;
    const aR = A.aRGB;
    const bg = dark ? P.bgD : P.bgL;
    const blob2 = P.blob2;
    const c = dark
      ? {
          text: "#e8f3f3", muted: "#9fb4b9", faint: "#6f8a90",
          panel: "rgba(255,255,255,.05)", panelStrong: "rgba(255,255,255,.08)",
          panelSoft: "rgba(255,255,255,.06)", chip: "rgba(255,255,255,.06)",
          border: "rgba(255,255,255,.10)", borderSoft: "rgba(255,255,255,.06)",
          input: "rgba(255,255,255,.05)", shadow: "rgba(0,0,0,.35)",
          user: rgba(aR, 0.16), assistant: "rgba(255,255,255,.06)"
        }
      : {
          text: "#0d2a31", muted: "#4a6770", faint: "#7f969d",
          panel: "rgba(255,255,255,.55)", panelStrong: "rgba(255,255,255,.72)",
          panelSoft: "rgba(255,255,255,.55)", chip: "rgba(255,255,255,.55)",
          border: "rgba(15,60,70,.12)", borderSoft: "rgba(15,60,70,.07)",
          input: "rgba(255,255,255,.6)", shadow: "rgba(13,60,70,.12)",
          user: rgba(aR, 0.1), assistant: "rgba(255,255,255,.7)"
        };
    return {
      "--accent": A.a, "--accent-2": A.a2, "--accent-strong": A.a2,
      "--accent-ink": A.aText, "--accent-rgb": aR.join(","),
      "--blob-2": blob2.join(","),
      "--bg-image": `radial-gradient(120% 90% at 12% 8%, ${bg[0]} 0%, ${bg[1]} 45%, ${bg[2]} 100%)`,
      "--bg-solid": bg[2],
      "--text": c.text, "--muted": c.muted, "--faint": c.faint,
      "--panel": c.panel, "--panel-strong": c.panelStrong, "--panel-soft": c.panelSoft,
      "--chip": c.chip, "--border": c.border, "--border-soft": c.borderSoft,
      "--input": c.input, "--shadow": c.shadow, "--user": c.user, "--assistant": c.assistant,
      "--blur": "22px", "--radius-panel": "16px", "--radius-card": "18px",
      "--shell-pad": "0px", "--shell-gap": "0px"
    };
  }

  // Spotlight
  const set = SPOTLIGHT[paletteId] ? paletteId : "amber";
  const P = SPOTLIGHT[set];
  const A = dark ? P.dark : P.light;
  const aR = A.aRGB;
  const bg = dark ? P.bgD : P.bgL;
  const tD = P.tintD, bL = P.borderL, sL = P.shadowL;
  const c = dark
    ? {
        text: "#f6ecdc", muted: "#bca988", faint: "#8a7960",
        panel: rgba(P.panelD, 0.62), panelStrong: rgba(P.panelD, 0.74),
        panelSoft: rgba(tD, 0.05), chip: rgba(tD, 0.05),
        border: rgba(tD, 0.12), borderSoft: rgba(tD, 0.07),
        input: rgba(tD, 0.06), shadow: "rgba(0,0,0,.45)",
        user: rgba(aR, 0.16), assistant: rgba(tD, 0.05), mainBg: rgba(P.panelD, 0.45)
      }
    : {
        text: "#33251a", muted: "#7a624a", faint: "#a08a6e",
        panel: "rgba(255,255,255,.66)", panelStrong: "rgba(255,255,255,.82)",
        panelSoft: "rgba(255,255,255,.5)", chip: "rgba(255,255,255,.55)",
        border: rgba(bL, 0.14), borderSoft: rgba(bL, 0.08),
        input: "rgba(255,255,255,.6)", shadow: rgba(sL, 0.12),
        user: rgba(aR, 0.1), assistant: "rgba(255,255,255,.7)", mainBg: "rgba(255,255,255,.45)"
      };
  return {
    "--accent": A.a, "--accent-2": A.a2, "--accent-strong": A.a2,
    "--accent-ink": A.aText, "--accent-rgb": aR.join(","),
    "--blob-2": aR.join(","),
    "--bg-image": `radial-gradient(110% 80% at 80% 0%, ${bg[0]} 0%, ${bg[1]} 55%, ${bg[2]} 100%)`,
    "--bg-solid": bg[2],
    "--text": c.text, "--muted": c.muted, "--faint": c.faint,
    "--panel": c.panel, "--panel-strong": c.panelStrong, "--panel-soft": c.panelSoft,
    "--chip": c.chip, "--border": c.border, "--border-soft": c.borderSoft,
    "--input": c.input, "--shadow": c.shadow, "--user": c.user, "--assistant": c.assistant,
    "--main-bg": c.mainBg,
    "--blur": "20px", "--radius-panel": "16px", "--radius-card": "22px",
    "--shell-pad": "14px", "--shell-gap": "14px"
  };
}
