import { DurableObject } from "cloudflare:workers";
import { createEngine } from "./engine";

export class MatchAuthority extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    const state = createEngine({ id: this.ctx.id.toString(), hostId: "", createdAtMs: Date.now() });
    return Response.json({ phase: state.phase, mode: state.mode });
  }
}
