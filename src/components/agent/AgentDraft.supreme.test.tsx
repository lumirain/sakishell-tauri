// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const celebrateTyping = vi.fn();
vi.mock("@/lib/typingConfetti", () => ({
  celebrateTyping: (...args: unknown[]) => celebrateTyping(...args),
}));

import { AgentTextarea } from "./AgentDraft";
import { useAgentDraftStore } from "@/stores/agentDraftStore";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<AgentTextarea draftKey="supreme-test" maxHeight={96} />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** React 受控 textarea 要走原生 setter 才会触发 onChange。 */
function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AgentTextarea x supreme effects", () => {
  it("hands the previous and the new text to the effect on every change", () => {
    const el = host.querySelector("textarea") as HTMLTextAreaElement;
    typeInto(el, "h");
    typeInto(el, "hi");
    expect(celebrateTyping).toHaveBeenCalledTimes(2);
    expect(celebrateTyping).toHaveBeenNthCalledWith(1, el, "", "h");
    expect(celebrateTyping).toHaveBeenNthCalledWith(2, el, "h", "hi");
  });

  it("does not let the effect get in the way of the draft itself", () => {
    const el = host.querySelector("textarea") as HTMLTextAreaElement;
    typeInto(el, "hello");
    expect(useAgentDraftStore.getState().drafts["supreme-test"]?.text).toBe("hello");
  });

  it("is not triggered by programmatic draft changes such as clearing after send", () => {
    const el = host.querySelector("textarea") as HTMLTextAreaElement;
    typeInto(el, "hello");
    celebrateTyping.mockClear();
    act(() => useAgentDraftStore.getState().setText("supreme-test", ""));
    expect(celebrateTyping).not.toHaveBeenCalled();
  });
});
