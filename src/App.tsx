import { useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import HomePage from "@/pages/HomePage";
import ProjectPage from "@/pages/ProjectPage";
import TerminalWindow from "@/pages/TerminalWindow";
import UpdateChecker from "@/components/UpdateChecker";
import { useProjectStore } from "@/stores/projectStore";
import type { Project, ProjectFileData } from "@/types";

function App() {
  const navigate = useNavigate();
  const { projects, addProject, updateProject } = useProjectStore();

  useEffect(() => {
    const unlisten = listen("navigate-home", () => {
      navigate("/");
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [navigate]);

  // Handle opening .orca workspace files (from double-click in OS)
  useEffect(() => {
    const unlisten = listen<string>("open-workspace-file", async (event) => {
      const filePath = event.payload;
      try {
        const projectData = await invoke<ProjectFileData>("load_project_file", { path: filePath });
        const primaryPath = projectData.folders[0]?.path || "";

        if (!primaryPath) {
          toast.error("Workspace file has no folders");
          return;
        }

        // Check if project with this path already exists
        const existingProject = projects.find(p => p.path === primaryPath);
        if (existingProject) {
          // Update existing project with folders from .orca file
          const updatedProject = {
            ...existingProject,
            name: projectData.name,
            folders: projectData.folders,
            lastOpened: new Date().toISOString(),
          };
          updateProject(existingProject.id, updatedProject);
          await invoke("add_project", { project: updatedProject });
          navigate(`/project/${existingProject.id}`);
          toast.success(`Opened workspace: ${projectData.name}`);
        } else {
          // Create new project
          const project: Project = {
            id: crypto.randomUUID(),
            name: projectData.name,
            path: primaryPath,
            folders: projectData.folders,
            lastOpened: new Date().toISOString(),
          };
          addProject(project);
          await invoke("add_project", { project });
          navigate(`/project/${project.id}`);
          toast.success(`Opened workspace: ${projectData.name}`);
        }
      } catch (error) {
        toast.error("Failed to open workspace file");
        console.error(error);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [navigate, projects, addProject, updateProject]);

  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:projectId" element={<ProjectPage />} />
          <Route path="/terminal" element={<TerminalWindow />} />
        </Routes>
        <Toaster position="top-right" />
        <UpdateChecker />
      </div>
    </TooltipProvider>
  );
}

export default App;
