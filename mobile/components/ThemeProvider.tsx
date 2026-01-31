import React, { createContext, useContext, useEffect } from "react";
import { View, useColorScheme } from "react-native";
import { useThemeStore, THEME_COLORS, ThemeOption } from "~/stores/themeStore";

interface ThemeContextValue {
  theme: Exclude<ThemeOption, "system">;
  colors: typeof THEME_COLORS.dark;
  setTheme: (theme: ThemeOption) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { theme, setTheme } = useThemeStore();
  const systemColorScheme = useColorScheme();

  // Resolve the theme
  const resolvedTheme: Exclude<ThemeOption, "system"> =
    theme === "system"
      ? systemColorScheme === "light"
        ? "light"
        : "dark"
      : theme;

  const colors = THEME_COLORS[resolvedTheme];

  return (
    <ThemeContext.Provider value={{ theme: resolvedTheme, colors, setTheme }}>
      <View
        className={`flex-1 ${resolvedTheme}`}
        style={{ backgroundColor: colors.background }}
      >
        {children}
      </View>
    </ThemeContext.Provider>
  );
}
