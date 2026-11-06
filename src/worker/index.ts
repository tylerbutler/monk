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
    if (!["/", "/index.html"].includes(url.pathname) || !["GET", "HEAD"].includes(request.method)) {
      return env.ASSETS.fetch(request);
    }
    const assetRequest = new Request(request);
    assetRequest.headers.delete("if-none-match");
    assetRequest.headers.delete("if-modified-since");
    const response = await env.ASSETS.fetch(assetRequest);
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) return response;

    const code = url.searchParams.get("room")?.trim().toUpperCase() ?? "";
    const invited = /^[A-Z2-9]{8}$/.test(code);
    const shareUrl = new URL("/", url);
    if (invited) shareUrl.searchParams.set("room", code);
    const image = new URL(`/brand/samples/${invited ? "invite-1080.png" : "social-1200x630.png"}`, url).href;
    const metadata: Record<string, string> = {
      "og:url": shareUrl.href, "og:image": image, "twitter:image": image,
    };
    if (invited) {
      const title = `Join Monk room ${code}`;
      const description = `You are invited to room ${code}. Join your friends for outdoor play. Change sides. Keep playing.`;
      const alt = "Monk. Your friends. New sides. Change sides. Keep playing.";
      Object.assign(metadata, {
        "og:title": title, "twitter:title": title,
        description, "og:description": description, "twitter:description": description,
        "og:image:width": "1080", "og:image:height": "1080",
        "og:image:alt": alt, "twitter:image:alt": alt, "twitter:card": "summary",
      });
    }
    const preview = new HTMLRewriter().on("head meta", {
      element(element) {
        const key = element.getAttribute("property") ?? element.getAttribute("name");
        if (key && metadata[key] !== undefined) element.setAttribute("content", metadata[key]);
      },
    }).transform(response);
    preview.headers.set("cache-control", "no-store");
    preview.headers.delete("etag");
    preview.headers.delete("last-modified");
    return preview;
  },
};
