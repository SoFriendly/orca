import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Settings, AIProvider, Snippet, ThemeOption, CustomThemeColors } from '@/types';
import { generateCustomThemeCSS, getThemeDefaultsAsHex } from '@/lib/colorUtils';

interface SettingsState extends Settings {
  defaultAssistant: string;
  hasSeenOnboarding: boolean;
  // Actions
  setTheme: (theme: ThemeOption) => void;
  setAIProvider: (provider: AIProvider | undefined) => void;
  setAssistantArgs: (assistantId: string, args: string) => void;
  addGlobalSnippet: (snippet: Snippet) => void;
  removeGlobalSnippet: (id: string) => void;
  updateGlobalSnippet: (id: string, updates: Partial<Snippet>) => void;
  setDefaultClonePath: (path: string | undefined) => void;
  setDefaultAssistant: (assistantId: string) => void;
  setAutoCommitMessage: (enabled: boolean) => void;
  setAutoFetchRemote: (enabled: boolean) => void;
  setHasSeenOnboarding: (seen: boolean) => void;
  // Custom theme actions
  setCustomTheme: (theme: CustomThemeColors | undefined) => void;
  setCustomThemeColor: (colorKey: keyof CustomThemeColors['colors'], value: string) => void;
  initializeCustomTheme: (baseTheme: 'dark' | 'tokyo' | 'light') => void;
}

// Apply theme to document
export const applyTheme = (theme: ThemeOption, customColors?: CustomThemeColors) => {
  const root = document.documentElement;
  // Remove all theme classes
  root.classList.remove('dark', 'tokyo', 'light', 'custom');

  // Remove existing custom style element
  const existingStyle = document.getElementById('custom-theme-style');
  if (existingStyle) {
    existingStyle.remove();
  }

  if (theme === 'custom' && customColors) {
    // Inject custom CSS
    const style = document.createElement('style');
    style.id = 'custom-theme-style';
    style.textContent = generateCustomThemeCSS(customColors.colors);
    document.head.appendChild(style);
    root.classList.add('custom');
  } else if (theme === 'light') {
    // Light mode - no class needed (uses :root)
  } else {
    // Add the theme class
    root.classList.add(theme);
  }
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      customTheme: undefined,
      aiProvider: undefined,
      assistantArgs: {},
      globalSnippets: [],
      defaultClonePath: undefined,
      defaultAssistant: 'claude',
      autoCommitMessage: true,
      autoFetchRemote: false,
      hasSeenOnboarding: false,

      setTheme: (theme) => {
        const customTheme = get().customTheme;
        applyTheme(theme, customTheme);
        set({ theme });
      },

      setAIProvider: (provider) => set({ aiProvider: provider }),

      setAssistantArgs: (assistantId, args) => set((state) => ({
        assistantArgs: { ...state.assistantArgs, [assistantId]: args },
      })),

      addGlobalSnippet: (snippet) => set((state) => ({
        globalSnippets: [...state.globalSnippets, snippet],
      })),

      removeGlobalSnippet: (id) => set((state) => ({
        globalSnippets: state.globalSnippets.filter((s) => s.id !== id),
      })),

      updateGlobalSnippet: (id, updates) => set((state) => ({
        globalSnippets: state.globalSnippets.map((s) =>
          s.id === id ? { ...s, ...updates } : s
        ),
      })),

      setDefaultClonePath: (path) => set({ defaultClonePath: path }),

      setDefaultAssistant: (assistantId) => set({ defaultAssistant: assistantId }),

      setAutoCommitMessage: (enabled) => set({ autoCommitMessage: enabled }),

      setAutoFetchRemote: (enabled) => set({ autoFetchRemote: enabled }),

      setHasSeenOnboarding: (seen) => set({ hasSeenOnboarding: seen }),

      setCustomTheme: (customTheme) => {
        set({ customTheme });
        const theme = get().theme;
        if (theme === 'custom' && customTheme) {
          applyTheme('custom', customTheme);
        }
      },

      setCustomThemeColor: (colorKey, value) => {
        const currentCustomTheme = get().customTheme;
        if (!currentCustomTheme) return;

        const updatedCustomTheme: CustomThemeColors = {
          ...currentCustomTheme,
          colors: {
            ...currentCustomTheme.colors,
            [colorKey]: value,
          },
        };
        set({ customTheme: updatedCustomTheme });
        applyTheme('custom', updatedCustomTheme);
      },

      initializeCustomTheme: (baseTheme) => {
        const customTheme: CustomThemeColors = {
          baseTheme,
          colors: getThemeDefaultsAsHex(baseTheme),
        };
        set({ customTheme, theme: 'custom' });
        applyTheme('custom', customTheme);
      },
    }),
    {
      name: 'chell-settings',
      onRehydrateStorage: () => (state) => {
        // Apply saved theme on load
        if (state?.theme) {
          applyTheme(state.theme, state.customTheme);
        }
      },
    }
  )
);
