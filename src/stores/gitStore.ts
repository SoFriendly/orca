import { create } from 'zustand';
import type { GitStatus, FileDiff, Branch, Commit, WorktreeInfo, Stash, Tag, PullRequest } from '@/types';

interface GitState {
  status: GitStatus | null;
  diffs: FileDiff[];
  branches: Branch[];
  history: Commit[];
  worktrees: WorktreeInfo[];
  stashes: Stash[];
  tags: Tag[];
  pullRequests: PullRequest[];
  conflictedFiles: string[];
  loading: boolean;
  error: string | null;

  // Actions
  setStatus: (status: GitStatus | null) => void;
  setDiffs: (diffs: FileDiff[]) => void;
  setBranches: (branches: Branch[]) => void;
  setHistory: (history: Commit[]) => void;
  setWorktrees: (worktrees: WorktreeInfo[]) => void;
  setStashes: (stashes: Stash[]) => void;
  setTags: (tags: Tag[]) => void;
  setPullRequests: (pullRequests: PullRequest[]) => void;
  setConflictedFiles: (files: string[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  status: null,
  diffs: [],
  branches: [],
  history: [],
  worktrees: [],
  stashes: [],
  tags: [],
  pullRequests: [],
  conflictedFiles: [],
  loading: false,
  error: null,
};

export const useGitStore = create<GitState>((set) => ({
  ...initialState,

  setStatus: (status) => set({ status }),
  setDiffs: (diffs) => set({ diffs }),
  setBranches: (branches) => set({ branches }),
  setHistory: (history) => set({ history }),
  setWorktrees: (worktrees) => set({ worktrees }),
  setStashes: (stashes) => set({ stashes }),
  setTags: (tags) => set({ tags }),
  setPullRequests: (pullRequests) => set({ pullRequests }),
  setConflictedFiles: (files) => set({ conflictedFiles: files }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
