export { MatchAuthority } from "./match-authority";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return Response.json({ error: "Unknown API route." }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};
