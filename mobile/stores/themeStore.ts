import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";

export type ThemeOption = "dark" | "tokyo" | "light" | "system";

interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  border: string;
  destructive: string;
}

// Theme color values for programmatic use
export const THEME_COLORS: Record<Exclude<ThemeOption, "system">, ThemeColors> = {
  dark: {
    background: "#121212",
    foreground: "#e5e5e5",
    card: "#171717",
    primary: "#ff8c00",
    primaryForeground: "#ffffff",
    secondary: "#1f1f1f",
    muted: "#262626",
    mutedForeground: "#8c8c8c",
    border: "#2e2e2e",
    destructive: "#dc2626",
  },
  tokyo: {
    background: "#1a1b26",
    foreground: "#c0caf5",
    card: "#1f2335",
    primary: "#7c3aed",
    primaryForeground: "#ffffff",
    secondary: "#24283b",
    muted: "#292e42",
    mutedForeground: "#737aa2",
    border: "#3b4261",
    destructive: "#f7768e",
  },
  light: {
    background: "#ffffff",
    foreground: "#0f172a",
    card: "#ffffff",
    primary: "#1e293b",
    primaryForeground: "#f8fafc",
    secondary: "#f1f5f9",
    muted: "#f1f5f9",
    mutedForeground: "#64748b",
    border: "#e2e8f0",
    destructive: "#dc2626",
  },
};

interface ThemeStore {
  theme: ThemeOption;
  syncWithDesktop: boolean;

  // Actions
  setTheme: (theme: ThemeOption) => void;
  setSyncWithDesktop: (sync: boolean) => void;
  getResolvedTheme: () => Exclude<ThemeOption, "system">;
  getColors: () => ThemeColors;
  getStatusBarStyle: () => "light" | "dark";
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: "dark",
      syncWithDesktop: true,

      setTheme: (theme: ThemeOption) => set({ theme }),

      setSyncWithDesktop: (sync: boolean) => set({ syncWithDesktop: sync }),

      getResolvedTheme: () => {
        const { theme } = get();
        if (theme === "system") {
          // In React Native, we'd use useColorScheme hook
          // For the store, default to dark
          return "dark";
        }
        return theme;
      },

      getColors: () => {
        const resolvedTheme = get().getResolvedTheme();
        return THEME_COLORS[resolvedTheme];
      },

      getStatusBarStyle: () => {
        const resolvedTheme = get().getResolvedTheme();
        return resolvedTheme === "light" ? "dark" : "light";
      },
    }),
    {
      name: "chell-theme",
      storage: createJSONStorage(() => AsyncStorage),
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
