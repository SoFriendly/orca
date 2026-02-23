// Orca Portal Relay Worker
// Handles WebSocket connections between desktop and mobile apps

export { SessionDO } from "./session";

interface Env {
  SESSIONS: DurableObjectNamespace;
  DEVICES: KVNamespace;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          version: "1.0.0",
          environment: env.ENVIRONMENT,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // WebSocket endpoint
    if (url.pathname === "/ws") {
      // Route to a single global Durable Object for simplicity
      // In production, you might want to shard by region or user
      const id = env.SESSIONS.idFromName("global");
      const stub = env.SESSIONS.get(id);

      return stub.fetch(request);
    }

    // API endpoints for device management
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, url, env, corsHeaders);
    }

    return new Response("Orca Portal Relay", {
      headers: corsHeaders,
    });
  },
};

async function handleApiRequest(
  request: Request,
  url: URL,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const path = url.pathname.replace("/api/", "");

  // Get device info
  if (path === "device" && request.method === "GET") {
    const deviceId = url.searchParams.get("id");
    if (!deviceId) {
      return new Response(JSON.stringify({ error: "Missing device ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const device = await env.DEVICES.get(deviceId, "json");
    if (!device) {
      return new Response(JSON.stringify({ error: "Device not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify(device), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Register device
  if (path === "device" && request.method === "POST") {
    const body = await request.json() as { id: string; name: string; type: string };
    const { id, name, type } = body;

    if (!id || !name || !type) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    await env.DEVICES.put(
      id,
      JSON.stringify({
        id,
        name,
        type,
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      })
    );

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
