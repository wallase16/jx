/**
 * Fake-host.js — a minimal in-memory `AssistantHost` for `@jxsuite/assistant`'s own unit tests.
 *
 * Mirrors the exact mutation semantics of studio's `tabs/transact.ts` `mutate*` helpers (splice
 * behavior for insert/remove/move, the "" / undefined / null → delete rule for
 * updateProperty/updateStyle, the direct-mutate-no-delete-rule for updateState) over a plain JS
 * object tree — no `Tab`, no `@vue/reactivity`, no real undo history. Batching is tracked with a
 * simple counter so agent-loop tests can assert "one batch opened, one batch closed" without a real
 * history stack.
 */

import type {
  AssistantHost,
  AssistantHostDocument,
  RenderedNode,
  SerializableRect,
} from "../src/host";
import type { JxMutableNode, JxPath } from "@jxsuite/schema/types";

function getNodeAtPath(doc: JxMutableNode, path: JxPath): any {
  let node: any = doc;
  for (const key of path) {
    if (node == null) {
      return undefined;
    }
    node = node[key];
  }
  return node;
}

/** Mirrors transact.ts's `childArray()` (via `@jxsuite/collab/ops`): fail loudly on the same misuse. */
function childArray(node: any): unknown[] {
  if (Array.isArray(node)) {
    throw new TypeError("Cannot insert into a children array; parentPath must point at a node");
  }
  if (!node.children) {
    node.children = [];
  }
  if (!Array.isArray(node.children)) {
    throw new TypeError("Cannot insert into mapped-array children; edit the map template instead");
  }
  return node.children;
}

export interface FakePerceptionOptions {
  selection?: JxPath | null;
  renderedTree?: RenderedNode[];
  measure?: { path: JxPath; rect: SerializableRect }[];
  /** No-highlight capability (perception present but `highlight` omitted) — pass `null`. */
  highlight?: ((paths: JxPath[], opts?: { ttl?: number }) => void) | null;
}

export interface FakeHostOptions {
  validate?: (doc: unknown) => Promise<string[]>;
  saveFile?: (relPath: string, content: string) => Promise<void>;
  openDocument?: (relPath: string) => Promise<void>;
  renderCheck?: (doc: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
  projectStyle?: Record<string, string>;
  /** Start with no active document (getDocument() returns null) — for "no document open" cases. */
  noDocument?: boolean;
  perception?: FakePerceptionOptions;
}

export interface FakeHostHandle {
  host: AssistantHost;
  getDoc: () => JxMutableNode;
  setDoc: (doc: JxMutableNode | null) => void;
  /** How many times beginBatch/endBatch were called, and whether a batch is open right now. */
  batch: { begins: number; ends: number; isOpen: () => boolean };
  /** Paths passed to `perception.highlight()`, one entry per call, in call order. */
  highlightCalls: JxPath[][];
}

/** Build a fresh fake host wrapping a deep clone of `document`. */
export function createFakeHost(
  document: Record<string, unknown> | null,
  opts: FakeHostOptions = {},
): FakeHostHandle {
  let doc: JxMutableNode | null = opts.noDocument
    ? null
    : (structuredClone(document) as JxMutableNode);
  let batching = false;
  const batch = { begins: 0, ends: 0, isOpen: () => batching };
  const highlightCalls: JxPath[][] = [];

  const docCapability: AssistantHostDocument = {
    getDocument: () => doc,
    getNodeAtPath: (path) => (doc ? getNodeAtPath(doc, path) : undefined),
    beginBatch() {
      batching = true;
      batch.begins += 1;
    },
    endBatch() {
      batching = false;
      batch.ends += 1;
    },
    isBatching: () => batching,
    insertNode(parentPath, index, node) {
      const parent = getNodeAtPath(doc!, parentPath);
      childArray(parent).splice(index, 0, structuredClone(node));
    },
    removeNode(path) {
      const parentPath = path.slice(0, -2);
      const idx = path.at(-1) as number;
      const parent = getNodeAtPath(doc!, parentPath);
      (parent.children as unknown[]).splice(idx, 1);
    },
    moveNode(fromPath, toParentPath, toIndex) {
      const fromParentPath = fromPath.slice(0, -2);
      const fromIdx = fromPath.at(-1) as number;
      const fromParent = getNodeAtPath(doc!, fromParentPath);
      const toParent = getNodeAtPath(doc!, toParentPath);
      const [node] = (fromParent.children as unknown[]).splice(fromIdx, 1);
      let adjustedIndex = toIndex;
      if (fromParent === toParent && fromIdx < toIndex) {
        adjustedIndex -= 1;
      }
      childArray(toParent).splice(adjustedIndex, 0, node);
    },
    updateProperty(path, key, value) {
      const node = getNodeAtPath(doc!, path);
      if (value === undefined || value === null || value === "") {
        delete node[key];
      } else {
        node[key] = value;
      }
    },
    updateStyle(path, property, value) {
      const node = getNodeAtPath(doc!, path);
      if (!node.style) {
        node.style = {};
      }
      if (value === undefined || value === "") {
        delete node.style[property];
      } else {
        node.style[property] = value;
      }
      if (Object.keys(node.style).length === 0) {
        delete node.style;
      }
    },
    updateState(key, value) {
      if (value === undefined || value === null) {
        if (doc!.state) {
          delete doc!.state[key];
        }
        return;
      }
      if (!doc!.state) {
        doc!.state = {};
      }
      doc!.state[key] = value;
    },
    setText(path, value) {
      const node = getNodeAtPath(doc!, path);
      delete node.textContent;
      node.children = [value];
    },
  };

  const host: AssistantHost = {
    document: docCapability,
    ...(opts.validate ? { validation: { validate: opts.validate } } : {}),
    ...(opts.saveFile || opts.openDocument
      ? {
          files: {
            saveFile:
              opts.saveFile ??
              (async () => {
                throw new Error("saveFile not configured on this fake host");
              }),
            openDocument:
              opts.openDocument ??
              (async () => {
                throw new Error("openDocument not configured on this fake host");
              }),
          },
        }
      : {}),
    ...(opts.projectStyle ? { project: { projectStyle: opts.projectStyle } } : {}),
    ...(opts.renderCheck ? { renderCheck: opts.renderCheck } : {}),
    ...(opts.perception
      ? {
          perception: {
            getSelection: () => opts.perception!.selection ?? null,
            getRenderedTree: async () => opts.perception!.renderedTree ?? [],
            measure: async (paths: JxPath[]) => {
              const all = opts.perception!.measure ?? [];
              return all.filter((m) =>
                paths.some((p) => JSON.stringify(p) === JSON.stringify(m.path)),
              );
            },
            ...(opts.perception.highlight === null
              ? {}
              : {
                  highlight: (paths: JxPath[], hOpts?: { ttl?: number }) => {
                    highlightCalls.push(paths);
                    opts.perception!.highlight?.(paths, hOpts);
                  },
                }),
          },
        }
      : {}),
  };

  return {
    host,
    getDoc: () => doc!,
    setDoc: (next) => {
      doc = next;
    },
    batch,
    highlightCalls,
  };
}
