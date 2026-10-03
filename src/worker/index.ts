import { issueCode } from "./auth";
export { MatchAuthority } from "./match-authority";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        return Response.json({ error: "HTTPS is required for private match sessions." }, { status: 426 });
      }
      if (url.search || (request.headers.has("origin") && request.headers.get("origin") !== url.origin)) {
        return Response.json({ error: "Same-origin requests without URL credentials are required." }, { status: 403 });
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
        const route = /^\/api\/matches\/([A-Z2-9]{8})\/(join|socket)$/.exec(url.pathname);
        if (route && ((route[2] === "join" && request.method === "POST") ||
          (route[2] === "socket" && request.method === "GET"))) {
          if (route[2] === "socket" && request.headers.get("origin") !== url.origin) {
            return Response.json({ error: "Same-origin WebSocket required." }, { status: 403 });
          }
          return await env.MATCHES.get(env.MATCHES.idFromName(route[1])).fetch(request);
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
