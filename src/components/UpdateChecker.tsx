import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpdateStore } from "@/stores/updateStore";

export default function UpdateChecker() {
  const {
    updateAvailable,
    isDownloading,
    isInstalling,
    downloadProgress,
    checkForUpdates,
    downloadAndInstall,
    dismiss,
  } = useUpdateStore();

  useEffect(() => {
    // Check for updates on mount (with a small delay to not block startup)
    const timer = setTimeout(() => {
      checkForUpdates().catch(() => {
        // Silently fail - update check is not critical
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  useEffect(() => {
    const unlisten = listen("check-for-updates", async () => {
      try {
        await checkForUpdates();
        const { updateAvailable: update } = useUpdateStore.getState();
        if (!update) {
          toast.info("You're up to date!", {
            description: "No new updates are available.",
          });
        }
      } catch {
        toast.error("Failed to check for updates.");
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [checkForUpdates]);

  const handleDownloadAndInstall = async () => {
    try {
      await downloadAndInstall();
      toast.success("Update installed! Restarting...");
    } catch (error) {
      console.error("Failed to download/install update:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to install update: ${errorMessage}`);
    }
  };

  if (!updateAvailable) return null;

  return (
    <Dialog open={!!updateAvailable} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Update Available
          </DialogTitle>
          <DialogDescription>
            A new version of Chell is available: <strong>v{updateAvailable.version}</strong>
          </DialogDescription>
        </DialogHeader>

        {updateAvailable.body && (
          <div className="max-h-48 overflow-auto rounded-lg bg-muted p-3">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {updateAvailable.body}
            </p>
          </div>
        )}

        {isDownloading && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Downloading... {downloadProgress}%
            </p>
          </div>
        )}

        {isInstalling && (
          <div className="flex items-center justify-center gap-2 py-4">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <p className="text-sm text-muted-foreground">Installing update...</p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={dismiss} disabled={isDownloading || isInstalling}>
            Later
          </Button>
          <Button
            onClick={handleDownloadAndInstall}
            disabled={isDownloading || isInstalling}
            className="bg-primary hover:bg-primary/90"
          >
            {isDownloading ? "Downloading..." : "Update Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
