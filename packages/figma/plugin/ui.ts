/**
 * UI — Figma plugin iframe logic (has a real DOM).
 *
 * Receives a serialized Figma node from the sandbox, converts it with figmaToJx, and mounts it
 * with the real Jx runtime — the "it's alive inside Figma" hook. No server, no build step at
 * runtime: the runtime is bundled into this script.
 *
 * @license MIT
 */

import { Jx } from "@jxsuite/runtime";
import { figmaToJx } from "../src/convert/figma-to-jx.ts";
import type { FigmaNode } from "../src/convert/figma-to-jx.ts";

interface NodeMessage {
  type: "node";
  node: FigmaNode;
}
interface EmptyMessage {
  type: "empty";
}
type PluginMessage = NodeMessage | EmptyMessage;

const mount = document.querySelector("#preview") as HTMLElement;
const status = document.querySelector("#status") as HTMLElement;

async function render(node: FigmaNode): Promise<void> {
  const { document: doc, nodeCount } = figmaToJx(node);
  mount.replaceChildren();
  try {
    await Jx(doc, mount);
    status.textContent = `Live preview — ${nodeCount} elements`;
  } catch (error) {
    status.textContent = `Render error: ${(error as Error).message}`;
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginMessage | undefined;
  if (!msg) {
    return;
  }
  if (msg.type === "empty") {
    mount.replaceChildren();
    status.textContent = "Select a frame to see it come alive.";
    return;
  }
  void render(msg.node);
});
