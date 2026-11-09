// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import Entry from "./Entry.svelte";

afterEach(() => { vi.restoreAllMocks(); });

it.each(["create", "join"] as const)("blocks both room actions while %s is pending and permits retry after failure", async action => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_, fail) => { reject = fail; });
  const create = vi.fn(() => pending), join = vi.fn(() => pending), reportError = vi.fn();
  const root = document.createElement("main"); document.body.append(root);
  const component = mount(Entry, { target: root, props: { invitedCode: null, error: "", errorField: "",
    create, join, reportError } });
  flushSync();
  try {
    const createButton = root.querySelector<HTMLButtonElement>("#action-create")!;
    const joinButton = root.querySelector<HTMLButtonElement>("#action-join")!;
    const code = root.querySelector<HTMLInputElement>("#matchCode")!;
    const name = root.querySelector<HTMLInputElement>("#displayName")!;
    const form = root.querySelector("form")!;
    code.value = "ABCDEFGH"; name.value = "River";
    if (action === "create") createButton.click();
    else form.dispatchEvent(new Event("submit", { cancelable: true }));
    flushSync();
    expect(createButton.disabled).toBe(true);
    expect(joinButton.disabled).toBe(true);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    createButton.click();
    expect(create.mock.calls.length + join.mock.calls.length).toBe(1);
    reject(new Error("Service unavailable."));
    await pending.catch(() => undefined); flushSync();
    expect(reportError).toHaveBeenCalledWith("Service unavailable.");
    expect(createButton.disabled).toBe(false);
    expect(joinButton.disabled).toBe(false);
    expect(code.value).toBe("ABCDEFGH");
    expect(name.value).toBe("River");
  } finally { await unmount(component); root.remove(); }
});
