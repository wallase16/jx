/**
 * UI — Figma plugin iframe logic (has a real DOM).
 *
 * Receives a serialized Figma node from the sandbox, converts it with figmaToJx, and mounts it
 * with the real Jx runtime — the "it's alive inside Figma" hook. No server, no build step at
 * runtime: the runtime is bundled into this script.
 *
 * Phase 2: adds "Download .jx project" — emits the converted document as a zip archive.
 *
 * @license MIT
 */

import { Jx } from "@jxsuite/runtime";
import { figmaToJx } from "../src/convert/figma-to-jx.ts";
import type { FigmaNode, ConvertResult } from "../src/convert/figma-to-jx.ts";
import { emitProject } from "../src/emit/emit.ts";
import { buildZip } from "../src/emit/zip.ts";

interface NodeMessage {
  type: "node";
  node: FigmaNode;
  imageRefs?: string[];
}
interface EmptyMessage {
  type: "empty";
}
interface ImagesMessage {
  type: "images";
  images: Record<string, number[]>;
}
type PluginMessage = NodeMessage | EmptyMessage | ImagesMessage;

const mount = document.querySelector("#preview") as HTMLElement;
const status = document.querySelector("#status") as HTMLElement;
const downloadBtn = document.querySelector("#download-btn") as HTMLButtonElement;

let lastResult: ConvertResult | null = null;
let lastImageRefs: string[] = [];
let pendingImages: Map<string, Uint8Array> | null = null;

async function render(node: FigmaNode): Promise<void> {
  const result = figmaToJx(node);
  lastResult = result;
  mount.replaceChildren();
  try {
    await Jx(result.document, mount);
    status.textContent = `Live preview — ${result.nodeCount} elements`;
    downloadBtn.disabled = false;
  } catch (error) {
    status.textContent = `Render error: ${(error as Error).message}`;
    downloadBtn.disabled = true;
  }
}

function requestImages(refs: string[]): void {
  if (refs.length === 0) {
    return;
  }
  parent.postMessage({ pluginMessage: { type: "request-images", refs } }, "*");
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function doDownload(): void {
  if (!lastResult) {
    return;
  }

  if (lastImageRefs.length > 0 && !pendingImages) {
    downloadBtn.disabled = true;
    status.textContent = "Fetching images…";
    pendingImages = new Map();
    requestImages(lastImageRefs);
    return;
  }

  const files = emitProject(lastResult, {
    projectName: "Figma Import",
    images: pendingImages ?? undefined,
  });

  const zip = buildZip(files);
  const blob = new Blob([zip], { type: "application/zip" });
  triggerDownload(blob, "figma-import.jx.zip");

  pendingImages = null;
  status.textContent = `Live preview — ${lastResult.nodeCount} elements`;
}

function handleImages(images: Record<string, number[]>): void {
  if (!pendingImages) {
    pendingImages = new Map();
  }
  for (const [ref, bytes] of Object.entries(images)) {
    pendingImages.set(ref, new Uint8Array(bytes));
  }
  downloadBtn.disabled = false;
  doDownload();
}

downloadBtn.addEventListener("click", doDownload);

window.addEventListener("message", (event: MessageEvent) => {
  const msg = (event.data as { pluginMessage?: PluginMessage }).pluginMessage;
  if (!msg) {
    return;
  }
  if (msg.type === "empty") {
    mount.replaceChildren();
    lastResult = null;
    lastImageRefs = [];
    pendingImages = null;
    downloadBtn.disabled = true;
    status.textContent = "Select a frame to see it come alive.";
    return;
  }
  if (msg.type === "images") {
    handleImages(msg.images);
    return;
  }
  lastImageRefs = msg.imageRefs ?? [];
  pendingImages = null;
  void render(msg.node);
});
