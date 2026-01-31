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
function parseHslToHex(hslString: string): string {
  const parts = hslString.trim().split(/\s+/);
  if (parts.length !== 3) return "#000000";
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]);
  const l = parseFloat(parts[2]);
  return hslToHex(h, s, l);
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
      theme: "dark",
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

        if (theme === "custom" && customTheme) {
          // Convert HSL strings to hex if needed
          const colors = customTheme.colors;
          return {
            background: colors.background.startsWith("#") ? colors.background : parseHslToHex(colors.background),
            foreground: colors.foreground.startsWith("#") ? colors.foreground : parseHslToHex(colors.foreground),
            card: colors.card.startsWith("#") ? colors.card : parseHslToHex(colors.card),
            cardForeground: colors.cardForeground.startsWith("#") ? colors.cardForeground : parseHslToHex(colors.cardForeground),
            primary: colors.primary.startsWith("#") ? colors.primary : parseHslToHex(colors.primary),
            primaryForeground: colors.primaryForeground.startsWith("#") ? colors.primaryForeground : parseHslToHex(colors.primaryForeground),
            secondary: colors.secondary.startsWith("#") ? colors.secondary : parseHslToHex(colors.secondary),
            secondaryForeground: colors.secondaryForeground.startsWith("#") ? colors.secondaryForeground : parseHslToHex(colors.secondaryForeground),
            muted: colors.muted.startsWith("#") ? colors.muted : parseHslToHex(colors.muted),
            mutedForeground: colors.mutedForeground.startsWith("#") ? colors.mutedForeground : parseHslToHex(colors.mutedForeground),
            accent: colors.accent.startsWith("#") ? colors.accent : parseHslToHex(colors.accent),
            accentForeground: colors.accentForeground.startsWith("#") ? colors.accentForeground : parseHslToHex(colors.accentForeground),
            border: colors.border.startsWith("#") ? colors.border : parseHslToHex(colors.border),
            input: colors.input.startsWith("#") ? colors.input : parseHslToHex(colors.input),
            destructive: colors.destructive.startsWith("#") ? colors.destructive : parseHslToHex(colors.destructive),
            destructiveForeground: colors.destructiveForeground.startsWith("#") ? colors.destructiveForeground : parseHslToHex(colors.destructiveForeground),
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
      name: "chell-theme",
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
