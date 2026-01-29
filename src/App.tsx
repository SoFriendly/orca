import { Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import HomePage from "@/pages/HomePage";
import ProjectPage from "@/pages/ProjectPage";

function App() {
  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground flex flex-col">
        {/* Draggable titlebar area for macOS */}
        <div
          data-tauri-drag-region
          className="h-8 w-full shrink-0 bg-background"
        />
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/project/:projectId" element={<ProjectPage />} />
          </Routes>
        </div>
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

export default App;
