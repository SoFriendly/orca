import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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

interface UpdateInfo {
  version: string;
  body?: string;
}

export default function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    // Check for updates on mount (with a small delay to not block startup)
    const timer = setTimeout(checkForUpdates, 3000);
    return () => clearTimeout(timer);
  }, []);

  const checkForUpdates = async () => {
    try {
      const update = await check();
      if (update) {
        setUpdateAvailable({
          version: update.version,
          body: update.body,
        });
      }
    } catch (error) {
      // Silently fail - update check is not critical
      console.error("Failed to check for updates:", error);
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!updateAvailable) return;

    setIsDownloading(true);
    try {
      const update = await check();
      if (!update) return;

      let contentLength = 0;
      let downloaded = 0;

      // Download the update
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            downloaded = 0;
            setDownloadProgress(0);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            const progress = contentLength > 0
              ? Math.round((downloaded / contentLength) * 100)
              : 0;
            setDownloadProgress(progress);
            break;
          case "Finished":
            setDownloadProgress(100);
            setIsDownloading(false);
            setIsInstalling(true);
            break;
        }
      });

      // Relaunch the app to apply the update
      toast.success("Update installed! Restarting...");
      await relaunch();
    } catch (error) {
      console.error("Failed to download/install update:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to install update: ${errorMessage}`);
      setIsDownloading(false);
      setIsInstalling(false);
    }
  };

  const handleDismiss = () => {
    setUpdateAvailable(null);
  };

  if (!updateAvailable) return null;

  return (
    <Dialog open={!!updateAvailable} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-portal-orange" />
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
                className="h-full bg-portal-orange transition-all duration-300"
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
          <Button variant="outline" onClick={handleDismiss} disabled={isDownloading || isInstalling}>
            Later
          </Button>
          <Button
            onClick={handleDownloadAndInstall}
            disabled={isDownloading || isInstalling}
            className="bg-portal-orange hover:bg-portal-orange/90"
          >
            {isDownloading ? "Downloading..." : "Update Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
