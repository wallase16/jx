/// <reference lib="dom" />
/**
 * In-iframe AI-assistant canvas perception (specs/ai-assistant.md §12). Runs INSIDE the canvas
 * iframe: {@link enumerateRenderedTree} walks the currently rendered `data-jx-path` elements into
 * `RenderedNode` rows for the `enumerate` → `renderedTree` round trip, and {@link applyHighlight}
 * draws transient visual emphasis for post-tool-call feedback (`highlight`).
 *
 * Split out from iframe-entry.ts's message switch for the same reason iframe-interaction.ts /
 * iframe-drop.ts are: keep the entry's dispatch thin and this logic independently testable.
 */

import { parseJxPath, serializeJxPath } from "./path-mapping";
import { rectOf } from "../utils/geometry";
import type { RenderedNode } from "./iframe-protocol";

/** How many characters of an element's own text content to surface as `textSnippet`. */
const TEXT_SNIPPET_LENGTH = 80;

/** Escape a serialized path for use inside a `[data-jx-path='...']` attribute selector. */
function pathSelector(path: (string | number)[]): string {
  const serialized = serializeJxPath(path);
  const esc = serialized.replaceAll("\\", String.raw`\\`).replaceAll("'", String.raw`\'`);
  return `[data-jx-path='${esc}']`;
}

/** Nearest `data-jx-path` ancestor of `el` (exclusive), or null if `el` is a root/detached. */
function nearestPathAncestor(el: Element): HTMLElement | null {
  let cur = el.parentElement;
  while (cur) {
    if (cur.dataset?.jxPath) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/** A short trimmed snippet of an element's own text, or undefined when there's none. */
function textSnippet(el: Element): string | undefined {
  const text = el.textContent?.trim();
  return text ? text.slice(0, TEXT_SNIPPET_LENGTH) : undefined;
}

/** Whether an element is hidden per computed style (display:none / visibility:hidden). */
function isHidden(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) {
    return false;
  }
  const style = view.getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

/**
 * Walk every `data-jx-path` element under `scopeRoot` (default: the whole document) into a flat
 * `RenderedNode[]` — ground truth for the AI assistant's `describe_canvas` tool. `childCount`
 * counts STAMPED descendants whose nearest stamped ancestor is this node (not raw DOM children —
 * text wrapper spans etc. don't count).
 */
export function enumerateRenderedTree(
  doc: Document,
  scopeRoot?: HTMLElement | null,
): RenderedNode[] {
  const descendants = [...(scopeRoot ?? doc).querySelectorAll("[data-jx-path]")] as HTMLElement[];
  // `querySelectorAll` only returns DESCENDANTS — a scoped call must also include the root itself,
  // Else describe_canvas({ root }) would silently omit the very node the caller asked about.
  const all = scopeRoot ? [scopeRoot, ...descendants] : descendants;
  const parentOf = new Map<HTMLElement, HTMLElement | null>();
  for (const el of all) {
    parentOf.set(el, nearestPathAncestor(el));
  }
  const childCount = new Map<HTMLElement, number>();
  for (const el of all) {
    const parent = parentOf.get(el);
    if (parent) {
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    }
  }
  return all.map((el) => {
    const r = rectOf(el);
    const node: RenderedNode = {
      childCount: childCount.get(el) ?? 0,
      path: parseJxPath(el.dataset.jxPath as string),
      rect: { height: r.height, width: r.width, x: r.x, y: r.y },
      tagName: el.tagName.toLowerCase(),
    };
    const snippet = textSnippet(el);
    if (snippet) {
      node.textSnippet = snippet;
    }
    if (isHidden(el)) {
      node.hidden = true;
    }
    return node;
  });
}

/** Resolve `root` (a document path) to its stamped element, or null if unresolvable/omitted. */
export function resolveScopeRoot(doc: Document, root?: (string | number)[]): HTMLElement | null {
  if (!root) {
    return null;
  }
  return doc.querySelector(pathSelector(root));
}

/**
 * A blue outline — legible over arbitrary rendered content without depending on the page's own
 * tokens.
 */
const HIGHLIGHT_OUTLINE = "2px solid #3b82f6";
const HIGHLIGHT_OFFSET = "2px";

interface HighlightState {
  timer: ReturnType<typeof setTimeout>;
  /** The element's own inline outline/outlineOffset before the FIRST highlight, so restore is exact. */
  originalOutline: string;
  originalOutlineOffset: string;
}

/**
 * One outstanding highlight per element, so a re-highlight before its TTL elapses resets the timer
 * instead of stacking (and restores to the true original, not an intermediate highlighted state).
 */
const highlightState = new WeakMap<HTMLElement, HighlightState>();

/**
 * Apply transient visual emphasis (an inline outline — no injected stylesheet needed, since the
 * iframe renders arbitrary project content) to each path that resolves to a stamped element; paths
 * that don't resolve (the node may have been removed by the very edit being highlighted) are
 * silently skipped. Each element's emphasis clears itself after `ttl` ms.
 */
export function applyHighlight(doc: Document, paths: (string | number)[][], ttl: number): void {
  for (const path of paths) {
    const el = doc.querySelector(pathSelector(path));
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    const existing = highlightState.get(el);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const originalOutline = existing?.originalOutline ?? el.style.outline;
    const originalOutlineOffset = existing?.originalOutlineOffset ?? el.style.outlineOffset;
    el.style.outline = HIGHLIGHT_OUTLINE;
    el.style.outlineOffset = HIGHLIGHT_OFFSET;
    const timer = setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.outlineOffset = originalOutlineOffset;
      highlightState.delete(el);
    }, ttl);
    highlightState.set(el, { originalOutline, originalOutlineOffset, timer });
  }
}
