import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Settings, AIProvider, Snippet, ThemeOption, CustomThemeColors, CustomAssistantConfig, AiProviderType } from '@/types';
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
  setAiApiKey: (key: string | undefined) => void;
  setAiProviderType: (provider: AiProviderType) => void;
  setAiModel: (model: string | undefined) => void;
  setPreferredEditor: (editor: string | undefined) => void;
  setShowHiddenFiles: (enabled: boolean) => void;
  // Custom assistant actions
  addCustomAssistant: (config: CustomAssistantConfig) => void;
  removeCustomAssistant: (id: string) => void;
  toggleAssistantHidden: (id: string) => void;
  // GitHub
  setGithubToken: (token: string | undefined) => void;
  // Custom theme actions
  setCustomTheme: (theme: CustomThemeColors | undefined) => void;
  setCustomThemeColor: (colorKey: keyof CustomThemeColors['colors'], value: string) => void;
  initializeCustomTheme: (baseTheme: 'dark' | 'tokyo' | 'light') => void;
  // Default panel visibility
  defaultPanels: { git: boolean; assistant: boolean; shell: boolean; notes: boolean };
  setDefaultPanelVisibility: (panel: keyof SettingsState['defaultPanels'], visible: boolean) => void;
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
      aiApiKey: undefined,
      aiProviderType: 'groq' as AiProviderType,
      aiModel: undefined,
      preferredEditor: undefined,
      showHiddenFiles: true,
      customAssistants: [],
      hiddenAssistantIds: [],
      githubToken: undefined,
      defaultPanels: { git: true, assistant: true, shell: true, notes: false },

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

      setAiApiKey: (key) => set({ aiApiKey: key }),

      setAiProviderType: (provider) => set({ aiProviderType: provider, aiModel: undefined }),

      setAiModel: (model) => set({ aiModel: model }),

      setPreferredEditor: (editor) => set({ preferredEditor: editor }),

      setShowHiddenFiles: (enabled) => set({ showHiddenFiles: enabled }),

      setGithubToken: (token) => set({ githubToken: token }),

      addCustomAssistant: (config) => set((state) => ({
        customAssistants: [...state.customAssistants, config],
      })),

      removeCustomAssistant: (id) => set((state) => {
        const newHidden = state.hiddenAssistantIds.filter((hid) => hid !== id);
        const newArgs = { ...state.assistantArgs };
        delete newArgs[id];
        return {
          customAssistants: state.customAssistants.filter((a) => a.id !== id),
          hiddenAssistantIds: newHidden,
          assistantArgs: newArgs,
        };
      }),

      toggleAssistantHidden: (id) => set((state) => {
        const isHidden = state.hiddenAssistantIds.includes(id);
        return {
          hiddenAssistantIds: isHidden
            ? state.hiddenAssistantIds.filter((hid) => hid !== id)
            : [...state.hiddenAssistantIds, id],
        };
      }),

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

      setDefaultPanelVisibility: (panel, visible) => set((state) => ({
        defaultPanels: { ...state.defaultPanels, [panel]: visible },
      })),

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
      name: 'orca-settings',
      onRehydrateStorage: () => (state) => {
        // Apply saved theme on load
        if (state?.theme) {
          applyTheme(state.theme, state.customTheme);
        }
      },
    }
  )
);
