import { issueCode } from "./auth";
export { MatchAuthority } from "./match-authority";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        return Response.json({ error: "HTTPS is required for private match sessions." }, { status: 426 });
      }
      const socketRoute = /^\/api\/matches\/([A-Z2-9]{8})\/socket\/websocket$/.exec(url.pathname);
      if ((!socketRoute && url.search) || (request.headers.has("origin") && request.headers.get("origin") !== url.origin)) {
        return Response.json({ error: "Same-origin requests without URL credentials are required." }, { status: 403 });
      }
      if (socketRoute) {
        const keys = [...url.searchParams.keys()];
        if (keys.some(key => key !== "vsn") || keys.length > 1 || request.headers.get("origin") !== url.origin) {
          return Response.json({ error: "Same-origin WebSocket without URL credentials required." }, { status: 403 });
        }
        if (url.searchParams.get("vsn") !== "2.0.0") {
          return Response.json({ error: "Phoenix version 2.0.0 required." }, { status: 400 });
        }
        if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return Response.json({ error: "WebSocket upgrade required." }, { status: 426 });
        }
      }
      try {
        if (url.pathname === "/api/matches" && request.method === "POST") {
          for (let attempt = 0; attempt < 5; attempt++) {
            const code = issueCode();
            const response = await env.MATCHES.get(env.MATCHES.idFromName(code)).fetch(
              new Request(new URL(`/api/matches/${code}/create`, url), request));
            if (response.status !== 409) return response;
          }
          return Response.json({ error: "Cannot allocate a private match. Try again." }, { status: 503 });
        }
        const route = /^\/api\/matches\/([A-Z2-9]{8})\/join$/.exec(url.pathname);
        if (socketRoute || route && request.method === "POST") {
          return await env.MATCHES.get(env.MATCHES.idFromName((socketRoute ?? route)![1])).fetch(request);
        }
        return Response.json({ error: "Unknown API route." }, { status: 404 });
      } catch {
        console.error("monk", "request_failed");
        return Response.json({ error: "Match service failed. Try again." }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
