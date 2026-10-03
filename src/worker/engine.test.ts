import { expect, it } from "vitest";
import { createEngine, isSuperior } from "./engine";

it("calls Gleam faction rules", () => {
  expect(isSuperior("rock", "scissors")).toBe(true);
  expect(isSuperior("rock", "paper")).toBe(false);
  expect(isSuperior("paper", "rock")).toBe(true);
  expect(isSuperior("scissors", "paper")).toBe(true);
  expect(isSuperior("rock", "rock")).toBe(false);
});

it("creates a lobby in testing mode", () => {
  const state = createEngine({ id: "m1", hostId: "h1", createdAtMs: 0 });
  expect(state.id).toBe("m1");
  expect(state.phase).toBe("lobby");
  expect(state.mode).toBe("test");
});
