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
      return new Response("Orca Releases", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Handle orca-latest.* and chell-latest.* (legacy) - redirect to the latest release files
    const latestFileMatch = key.match(/^(?:orca|chell)-latest(?:-(arm64|amd64))?\.(dmg|AppImage|deb|msi|exe)$/);
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

          // Extract version from a platform URL (e.g. ".../v0.1.95/Orca_0.1.95_..." -> "0.1.95")
          const extractVersion = (platformKey: string): string | null => {
            const platformUrl = latest.platforms[platformKey]?.url;
            if (!platformUrl) return null;
            const match = platformUrl.match(/Orca_([\d.]+)/);
            return match ? match[1] : null;
          };

          const archSuffix = arch === "arm64" ? "arm64" : "amd64";

          // Map each extension to its platform key so we derive the version
          // from the actual platform entry rather than using a single global version.
          // This prevents redirecting to a version that was never built for that platform.
          const platformForExt: Record<string, string> = {
            dmg: "darwin-aarch64",
            AppImage: `linux-${arch === "arm64" ? "aarch64" : "x86_64"}`,
            deb: `linux-${arch === "arm64" ? "aarch64" : "x86_64"}`,
            msi: "windows-x86_64",
            exe: "windows-x86_64",
          };

          const platformKey = platformForExt[ext];
          const version = (platformKey && extractVersion(platformKey)) || latest.version;

          const fileMap: Record<string, string> = {
            dmg: `v${version}/Orca_${version}_aarch64.dmg`,
            AppImage: `v${version}/Orca_${version}_${archSuffix}.AppImage`,
            deb: `v${version}/Orca_${version}_${archSuffix}.deb`,
            msi: `v${version}/Orca_${version}_x64-setup.msi`,
            exe: `v${version}/Orca_${version}_x64-setup.exe`,
          };

          const targetKey = fileMap[ext];
          if (targetKey) {
            return Response.redirect(`${url.origin}/${targetKey}`, 302);
          }
        }
      } catch (e) {
        return new Response(`Could not determine latest version: ${e}`, { status: 500 });
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
