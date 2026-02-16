export interface Env {
  BUCKET: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const key = url.pathname.slice(1); // Remove leading slash

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // Only allow GET and HEAD
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Handle root path
    if (!key) {
      return new Response("Chell Releases", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Handle chell-latest.* and chell-latest-{arch}.* - redirect to the latest release files
    const latestFileMatch = key.match(/^chell-latest(?:-(arm64|amd64))?\.(dmg|AppImage|deb|msi|exe)$/);
    if (latestFileMatch) {
      try {
        const latestJson = await env.BUCKET.get("latest.json");
        if (latestJson) {
          const latest = await latestJson.json<{
            version: string;
            platforms: Record<string, { url: string; signature: string }>;
          }>();
          const arch = latestFileMatch[1]; // arm64, amd64, or undefined
          const ext = latestFileMatch[2];

          // Map extension + arch to platform key
          const getPlatformKey = (ext: string, arch?: string): string => {
            if (ext === "dmg") return "darwin-aarch64";
            if (ext === "AppImage" || ext === "deb") {
              return arch === "arm64" ? "linux-aarch64" : "linux-x86_64";
            }
            return "windows-x86_64";
          };

          const platformKey = getPlatformKey(ext, arch);
          const platform = latest.platforms?.[platformKey];

          if (platform?.url) {
            return Response.redirect(platform.url, 302);
          }

          // Fallback: construct URL from version
          const version = latest.version;
          const archSuffix = arch === "arm64" ? "arm64" : "amd64";
          const fileMap: Record<string, string> = {
            dmg: `v${version}/Chell_${version}_aarch64.dmg`,
            AppImage: `v${version}/Chell_${version}_${archSuffix}.AppImage`,
            deb: `v${version}/Chell_${version}_${archSuffix}.deb`,
            msi: `v${version}/Chell_${version}_x64-setup.msi`,
            exe: `v${version}/Chell_${version}_x64-setup.exe`,
          };

          const targetKey = fileMap[ext];
          if (targetKey) {
            return Response.redirect(`${url.origin}/${targetKey}`, 302);
          }
        }
      } catch {
        return new Response("Could not determine latest version", { status: 500 });
      }
    }

    try {
      const object = await env.BUCKET.get(key);

      if (!object) {
        return new Response("Not Found", { status: 404 });
      }

      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("etag", object.httpEtag);

      // Set content type based on file extension
      if (key.endsWith(".json")) {
        headers.set("Content-Type", "application/json");
      } else if (key.endsWith(".dmg")) {
        headers.set("Content-Type", "application/x-apple-diskimage");
      } else if (key.endsWith(".exe") || key.endsWith(".msi")) {
        headers.set("Content-Type", "application/octet-stream");
      } else if (key.endsWith(".AppImage")) {
        headers.set("Content-Type", "application/x-executable");
      } else if (key.endsWith(".deb")) {
        headers.set("Content-Type", "application/vnd.debian.binary-package");
      } else if (key.endsWith(".tar.gz")) {
        headers.set("Content-Type", "application/gzip");
      } else if (key.endsWith(".sig")) {
        headers.set("Content-Type", "text/plain");
      }

      // Add content disposition for downloads
      if (!key.endsWith(".json") && !key.endsWith(".sig")) {
        const filename = key.split("/").pop();
        headers.set("Content-Disposition", `attachment; filename="${filename}"`);
      }

      if (object.size) {
        headers.set("Content-Length", object.size.toString());
      }

      return new Response(object.body, { headers });
    } catch (e) {
      return new Response("Internal Error", { status: 500 });
    }
  },
};
