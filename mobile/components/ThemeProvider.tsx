import React, { createContext, useContext } from "react";
import { View, useColorScheme } from "react-native";
import { useThemeStore, THEME_COLORS, ThemeOption, ThemeColors } from "~/stores/themeStore";

interface ThemeContextValue {
  theme: Exclude<ThemeOption, "system">;
  colors: ThemeColors;
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
  const { theme, setTheme, customTheme, getColors } = useThemeStore();
  const systemColorScheme = useColorScheme();

  // Resolve the theme
  const resolvedTheme: Exclude<ThemeOption, "system"> =
    theme === "system"
      ? systemColorScheme === "light"
        ? "light"
        : "dark"
      : theme;

  // Get colors - handles custom theme internally
  const colors = getColors();

  // Get the theme class for NativeWind - for custom themes, use the base theme
  const themeClass =
    resolvedTheme === "custom"
      ? customTheme?.baseTheme || "dark"
      : resolvedTheme;

  return (
    <ThemeContext.Provider value={{ theme: resolvedTheme, colors, setTheme }}>
      <View
        className={`flex-1 ${themeClass}`}
        style={{ backgroundColor: colors.background }}
      >
        {children}
      </View>
    </ThemeContext.Provider>
  );
}
