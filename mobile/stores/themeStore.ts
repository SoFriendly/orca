import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";

export type ThemeOption = "dark" | "tokyo" | "light" | "custom" | "system";

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  input: string;
  destructive: string;
  destructiveForeground: string;
  // Semantic colors
  success: string;
  info: string;
  warning: string;
  ai: string;
  terminal: string;
}

// Helper to convert HSL string to hex
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Parse CSS HSL value like "0 0% 7%" to hex
function parseHslToHex(hslString: string | undefined): string {
  if (!hslString || typeof hslString !== "string") return "#000000";
  const parts = hslString.trim().split(/\s+/);
  if (parts.length !== 3) return "#000000";
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]);
  const l = parseFloat(parts[2]);
  return hslToHex(h, s, l);
}

// Safely get a color value, handling undefined
function safeColor(value: string | undefined, fallback: string): string {
  if (!value || typeof value !== "string") return fallback;
  return value.startsWith("#") ? value : parseHslToHex(value);
}

// Theme color values for programmatic use
export const THEME_COLORS: Record<Exclude<ThemeOption, "system" | "custom">, ThemeColors> = {
  dark: {
    background: "#121212",
    foreground: "#e5e5e5",
    card: "#171717",
    cardForeground: "#e5e5e5",
    primary: "#ff8c00",
    primaryForeground: "#ffffff",
    secondary: "#1f1f1f",
    secondaryForeground: "#e5e5e5",
    muted: "#262626",
    mutedForeground: "#8c8c8c",
    accent: "#262626",
    accentForeground: "#e5e5e5",
    border: "#2e2e2e",
    input: "#2e2e2e",
    destructive: "#dc2626",
    destructiveForeground: "#ffffff",
    success: "#22c55e",
    info: "#60a5fa",
    warning: "#eab308",
    ai: "#a78bfa",
    terminal: "#4ade80",
  },
  tokyo: {
    background: "#1a1b26",
    foreground: "#c0caf5",
    card: "#1f2335",
    cardForeground: "#c0caf5",
    primary: "#7c3aed",
    primaryForeground: "#ffffff",
    secondary: "#24283b",
    secondaryForeground: "#c0caf5",
    muted: "#292e42",
    mutedForeground: "#737aa2",
    accent: "#292e42",
    accentForeground: "#c0caf5",
    border: "#3b4261",
    input: "#3b4261",
    destructive: "#f7768e",
    destructiveForeground: "#ffffff",
    success: "#9ece6a",
    info: "#7aa2f7",
    warning: "#e0af68",
    ai: "#bb9af7",
    terminal: "#9ece6a",
  },
  light: {
    background: "#ffffff",
    foreground: "#0f172a",
    card: "#ffffff",
    cardForeground: "#0f172a",
    primary: "#1e293b",
    primaryForeground: "#f8fafc",
    secondary: "#f1f5f9",
    secondaryForeground: "#0f172a",
    muted: "#f1f5f9",
    mutedForeground: "#64748b",
    accent: "#f1f5f9",
    accentForeground: "#0f172a",
    border: "#e2e8f0",
    input: "#e2e8f0",
    destructive: "#dc2626",
    destructiveForeground: "#ffffff",
    success: "#16a34a",
    info: "#2563eb",
    warning: "#ca8a04",
    ai: "#7c3aed",
    terminal: "#16a34a",
  },
};

interface CustomThemeColors {
  baseTheme: "dark" | "tokyo" | "light";
  colors: {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    border: string;
    input: string;
    destructive: string;
    destructiveForeground: string;
    success?: string;
    info?: string;
    warning?: string;
    ai?: string;
    terminal?: string;
  };
}

interface ThemeStore {
  theme: ThemeOption;
  customTheme: CustomThemeColors | null;
  syncWithDesktop: boolean;

  // Actions
  setTheme: (theme: ThemeOption) => void;
  setCustomTheme: (customTheme: CustomThemeColors | null) => void;
  setSyncWithDesktop: (sync: boolean) => void;
  getResolvedTheme: () => Exclude<ThemeOption, "system">;
  getColors: () => ThemeColors;
  getStatusBarStyle: () => "light" | "dark";

  // Sync from desktop
  syncFromDesktop: (theme: string, customTheme?: CustomThemeColors) => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: "tokyo",
      customTheme: null,
      syncWithDesktop: true,

      setTheme: (theme: ThemeOption) => set({ theme }),

      setCustomTheme: (customTheme: CustomThemeColors | null) => set({ customTheme }),

      setSyncWithDesktop: (sync: boolean) => set({ syncWithDesktop: sync }),

      getResolvedTheme: () => {
        const { theme } = get();
        if (theme === "system") {
          return "dark";
        }
        return theme;
      },

      getColors: (): ThemeColors => {
        const { theme, customTheme } = get();

        if (theme === "custom" && customTheme?.colors) {
          // Convert HSL strings to hex if needed, with fallbacks for missing values
          const colors = customTheme.colors;
          const base = THEME_COLORS[customTheme.baseTheme] || THEME_COLORS.dark;
          return {
            background: safeColor(colors.background, base.background),
            foreground: safeColor(colors.foreground, base.foreground),
            card: safeColor(colors.card, base.card),
            cardForeground: safeColor(colors.cardForeground, base.cardForeground),
            primary: safeColor(colors.primary, base.primary),
            primaryForeground: safeColor(colors.primaryForeground, base.primaryForeground),
            secondary: safeColor(colors.secondary, base.secondary),
            secondaryForeground: safeColor(colors.secondaryForeground, base.secondaryForeground),
            muted: safeColor(colors.muted, base.muted),
            mutedForeground: safeColor(colors.mutedForeground, base.mutedForeground),
            accent: safeColor(colors.accent, base.accent),
            accentForeground: safeColor(colors.accentForeground, base.accentForeground),
            border: safeColor(colors.border, base.border),
            input: safeColor(colors.input, base.input),
            destructive: safeColor(colors.destructive, base.destructive),
            destructiveForeground: safeColor(colors.destructiveForeground, base.destructiveForeground),
            success: safeColor(colors.success, base.success),
            info: safeColor(colors.info, base.info),
            warning: safeColor(colors.warning, base.warning),
            ai: safeColor(colors.ai, base.ai),
            terminal: safeColor(colors.terminal, base.terminal),
          };
        }

        if (theme === "system") {
          return THEME_COLORS.dark;
        }

        if (theme === "custom") {
          // No custom theme set, fall back to dark
          return THEME_COLORS.dark;
        }

        return THEME_COLORS[theme];
      },

      getStatusBarStyle: () => {
        const { theme, customTheme } = get();
        if (theme === "light") return "dark";
        if (theme === "custom" && customTheme?.baseTheme === "light") return "dark";
        return "light";
      },

      syncFromDesktop: (theme: string, customTheme?: CustomThemeColors) => {
        const validThemes = ["dark", "tokyo", "light", "custom"];
        if (!validThemes.includes(theme)) return;

        if (theme === "custom" && customTheme) {
          set({
            theme: "custom" as ThemeOption,
            customTheme
          });
        } else {
          set({ theme: theme as ThemeOption });
        }
      },
    }),
    {
      name: "orca-theme",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        theme: state.theme,
        customTheme: state.customTheme,
        syncWithDesktop: state.syncWithDesktop,
      }),
    }
  )
);

// Hook to get resolved theme with system preference
export function useResolvedTheme(): Exclude<ThemeOption, "system"> {
  const { theme } = useThemeStore();
  const systemColorScheme = useColorScheme();

  if (theme === "system") {
    return systemColorScheme === "light" ? "light" : "dark";
  }
  return theme;
}
