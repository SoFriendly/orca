import { create } from "zustand";
import type { GitStatus, FileDiff, Branch, Commit } from "~/types";
import { useConnectionStore } from "./connectionStore";

interface GitStore {
  // State
  status: GitStatus | null;
  diffs: FileDiff[];
  branches: Branch[];
  history: Commit[];
  loading: boolean;
  error: string | null;
  showBranchPicker: boolean;

  // Actions
  setShowBranchPicker: (show: boolean) => void;
  toggleBranchPicker: () => void;
  refresh: (projectPath: string) => Promise<void>;
  commit: (projectPath: string, message: string, files?: string[]) => Promise<void>;
  stageFile: (projectPath: string, filePath: string) => Promise<void>;
  unstageFile: (projectPath: string, filePath: string) => Promise<void>;
  discardFile: (projectPath: string, filePath: string) => Promise<void>;
  checkoutBranch: (projectPath: string, branch: string) => Promise<void>;
  createBranch: (projectPath: string, name: string) => Promise<void>;
  pull: (projectPath: string) => Promise<void>;
  push: (projectPath: string) => Promise<void>;
  generateCommitMessage: (diffs: FileDiff[]) => Promise<{ subject: string; description: string }>;
}

export const useGitStore = create<GitStore>((set, get) => ({
  status: null,
  diffs: [],
  branches: [],
  history: [],
  loading: false,
  error: null,
  showBranchPicker: false,

  setShowBranchPicker: (show: boolean) => set({ showBranchPicker: show }),
  toggleBranchPicker: () => set((state) => ({ showBranchPicker: !state.showBranchPicker })),

  refresh: async (projectPath: string) => {
    const { invoke } = useConnectionStore.getState();
    set({ loading: true, error: null });

    try {
      const [status, diffs, branches, history] = await Promise.all([
        invoke<GitStatus>("get_status", { repoPath: projectPath }),
        invoke<FileDiff[]>("get_diff", { repoPath: projectPath }),
        invoke<Branch[]>("get_branches", { repoPath: projectPath }),
        invoke<Commit[]>("get_history", { repoPath: projectPath, limit: 50 }),
      ]);

      set({ status, diffs, branches, history, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to refresh git status",
      });
    }
  },

  commit: async (projectPath: string, message: string, files?: string[]) => {
    const { invoke } = useConnectionStore.getState();
    set({ loading: true, error: null });

    try {
      await invoke("commit", { repoPath: projectPath, message, files });
      await get().refresh(projectPath);
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to commit",
      });
      throw err;
    }
  },

  stageFile: async (projectPath: string, filePath: string) => {
    const { invoke } = useConnectionStore.getState();
    try {
      await invoke("stage_file", { repoPath: projectPath, filePath });
      await get().refresh(projectPath);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to stage file",
      });
    }
  },

  unstageFile: async (projectPath: string, filePath: string) => {
    const { invoke } = useConnectionStore.getState();
    try {
      await invoke("unstage_file", { repoPath: projectPath, filePath });
      await get().refresh(projectPath);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to unstage file",
      });
    }
  },

  discardFile: async (projectPath: string, filePath: string) => {
    const { invoke } = useConnectionStore.getState();
    try {
      await invoke("discard_file", { repoPath: projectPath, filePath });
      await get().refresh(projectPath);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to discard file",
      });
    }
  },

  checkoutBranch: async (projectPath: string, branch: string) => {
    const { invoke } = useConnectionStore.getState();
    set({ loading: true, error: null });

    try {
      await invoke("checkout_branch", { repoPath: projectPath, branch });
      await get().refresh(projectPath);
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to checkout branch",
      });
      throw err;
    }
  },

  createBranch: async (projectPath: string, name: string) => {
    const { invoke } = useConnectionStore.getState();
    try {
      await invoke("create_branch", { repoPath: projectPath, name });
      await get().refresh(projectPath);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create branch",
      });
      throw err;
    }
  },

  pull: async (projectPath: string) => {
    const { invoke } = useConnectionStore.getState();
    set({ loading: true, error: null });

    try {
      await invoke("pull_remote", { repoPath: projectPath, remote: "origin" });
      await get().refresh(projectPath);
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to pull",
      });
      throw err;
    }
  },

  push: async (projectPath: string) => {
    const { invoke } = useConnectionStore.getState();
    set({ loading: true, error: null });

    try {
      await invoke("push_remote", { repoPath: projectPath, remote: "origin" });
      await get().refresh(projectPath);
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to push",
      });
      throw err;
    }
  },

  generateCommitMessage: async (diffs: FileDiff[]): Promise<{ subject: string; description: string }> => {
    const { invoke } = useConnectionStore.getState();
    console.log("[GitStore] generateCommitMessage called with", diffs.length, "diffs");
    try {
      const result = await invoke<{ subject: string; description: string }>(
        "generate_commit_message",
        { diffs }
      );
      console.log("[GitStore] Got result:", result);
      return { subject: result.subject, description: result.description || "" };
    } catch (err) {
      console.error("[GitStore] generateCommitMessage error:", err);
      throw new Error(
        err instanceof Error ? err.message : "Failed to generate commit message"
      );
    }
  },
}));
