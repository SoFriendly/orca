import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project, ProjectTab, ProjectFolder } from '@/types';

// Helper to ensure project has folders array (backward compat migration)
export const ensureFolders = (project: Project): Project => {
  if (!project.folders || project.folders.length === 0) {
    const folderName = project.path.split(/[/\\]/).pop() || project.name;
    return {
      ...project,
      folders: [{
        id: crypto.randomUUID(),
        name: folderName,
        path: project.path,
      }],
    };
  }
  return project;
};

interface ProjectState {
  projects: Project[];
  tabs: ProjectTab[];
  activeTabId: string | null;

  // Actions
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  addFolderToProject: (projectId: string, folder: ProjectFolder) => void;
  removeFolderFromProject: (projectId: string, folderId: string) => void;

  openTab: (project: Project) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, _get) => ({
      projects: [],
      tabs: [],
      activeTabId: null,

      setProjects: (projects) => set({
        projects: projects.map(ensureFolders)
      }),

      addProject: (project) => set((state) => {
        const migratedProject = ensureFolders(project);
        // Check if project already exists (by path)
        const exists = state.projects.some(p => p.path === migratedProject.path);
        if (exists) {
          // Update existing project with all new data (name, folders, lastOpened)
          return {
            projects: state.projects.map(p =>
              p.path === migratedProject.path ? { ...p, ...migratedProject } : p
            ),
          };
        }
        return { projects: [...state.projects, migratedProject] };
      }),

      removeProject: (id) => set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        tabs: state.tabs.filter((t) => t.projectId !== id),
      })),

      updateProject: (id, updates) => set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id ? { ...p, ...updates } : p
        ),
      })),

      addFolderToProject: (projectId, folder) => set((state) => ({
        projects: state.projects.map((p) => {
          if (p.id !== projectId) return p;
          const folders = p.folders || [];
          // Don't add duplicate paths
          if (folders.some(f => f.path === folder.path)) return p;
          return { ...p, folders: [...folders, folder] };
        }),
      })),

      removeFolderFromProject: (projectId, folderId) => set((state) => ({
        projects: state.projects.map((p) => {
          if (p.id !== projectId) return p;
          const folders = (p.folders || []).filter(f => f.id !== folderId);
          // Keep at least one folder
          if (folders.length === 0) return p;
          // Update primary path if we removed the first folder
          const newPath = folders[0].path;
          return { ...p, folders, path: newPath };
        }),
      })),

      openTab: (project) => set((state) => {
        const existingTab = state.tabs.find((t) => t.projectId === project.id);
        if (existingTab) {
          return { activeTabId: existingTab.id };
        }
        const newTab: ProjectTab = {
          id: crypto.randomUUID(),
          projectId: project.id,
          projectName: project.name,
        };
        return {
          tabs: [...state.tabs, newTab],
          activeTabId: newTab.id,
        };
      }),

      closeTab: (tabId) => set((state) => {
        const newTabs = state.tabs.filter((t) => t.id !== tabId);
        let newActiveTabId = state.activeTabId;
        if (state.activeTabId === tabId) {
          newActiveTabId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
        }
        return { tabs: newTabs, activeTabId: newActiveTabId };
      }),

      setActiveTab: (tabId) => set({ activeTabId: tabId }),
    }),
    {
      name: 'orca-projects',
      partialize: (state) => ({ projects: state.projects }), // Only persist projects, not tabs
    }
  )
);