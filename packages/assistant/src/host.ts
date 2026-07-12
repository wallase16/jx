/**
 * Host.js — the `AssistantHost` capability-injection contract.
 *
 * `@jxsuite/assistant`'s tools, agent loop, and system prompt never touch a Jx `Tab`, `tabs/
 * transact`, or studio's reactive `store.js`/`state.js` directly — they only ever call through this
 * interface. A host implementation supplies the actual document mutation machinery (studio wires it
 * to `tabs/transact`; the headless eval harness wires it to an in-memory `createTab`-backed
 * document). See specs/ai-assistant.md §11.3.
 *
 * @license MIT
 */

import type {
  JxMutableNode,
  JxPath,
  JxStateDefinition,
  ProjectConfig,
} from "@jxsuite/schema/types";

/**
 * A discovered component the assistant can suggest reusing. Deliberately loose — hosts may pass
 * through their own richer component-registry entry shape (e.g. studio's `ComponentEntry`), so this
 * package only depends on the handful of fields `system-prompt.ts` actually reads.
 */
export interface ComponentEntry {
  $id?: string | null;
  tagName?: string;
  tag?: string;
  name?: string;
  path?: string;
}

/**
 * Result of a render-time probe: `{ ok: true }` or a `{ ok: false, error }` with an actionable
 * message.
 */
export type RenderCheckResult = { ok: true } | { ok: false; error: string };

/**
 * Required document-mutation capability. Each method is one atomic, independently-undoable
 * transaction (a studio host wraps each in `transactDoc()`); `beginBatch`/`endBatch` group a whole
 * agent-loop turn into a single undo step.
 */
export interface AssistantHostDocument {
  /** The current document, already de-proxied (`toRaw()`'d) if the host's storage is reactive. */
  getDocument: () => JxMutableNode | null;
  getNodeAtPath: (path: JxPath) => unknown;
  /** Open a batch: subsequent mutations collapse into one undo step until `endBatch()`. */
  beginBatch: () => void;
  endBatch: () => void;
  /**
   * Whether a batch is currently open (used by `open_document` to re-batch across a document
   * switch).
   */
  isBatching: () => boolean;
  insertNode: (parentPath: JxPath, index: number, node: JxMutableNode) => void;
  removeNode: (path: JxPath) => void;
  moveNode: (fromPath: JxPath, toParentPath: JxPath, toIndex: number) => void;
  updateProperty: (path: JxPath, key: string, value: unknown) => void;
  updateStyle: (path: JxPath, property: string, value: string | undefined) => void;
  /**
   * `value == null` removes the state key; otherwise it's set (bypassing updateProperty's "" →
   * delete rule).
   */
  updateState: (key: string, value: JxStateDefinition | undefined) => void;
  /** Replace a node's textContent with a single text child (`set_text`'s exact semantics). */
  setText: (path: JxPath, value: string) => void;
}

/**
 * A formal capability-injection contract, replacing the two ad hoc injection sites
 * `registerAiTools(registry, { getTab, validate?, saveFile?, renderCheck?, openDocument?,
 * projectStyle? })` and `runAgentLoop({ ..., getTab? })`.
 *
 * Absent-capability semantics: every tool is always registered regardless of which optional
 * capabilities are present — a tool whose backing capability is missing returns `{ success: false,
 * error: "<X> is not available in this environment." }` at call time.
 */
export interface AssistantHost {
  document: AssistantHostDocument;
  validation?: { validate: (doc: unknown) => Promise<string[]> };
  files?: {
    saveFile: (relPath: string, content: string) => Promise<void>;
    openDocument: (relPath: string) => Promise<void>;
  };
  project?: {
    projectStyle?: Record<string, string>;
    projectConfig?: ProjectConfig;
    components?: ComponentEntry[];
    projectRoot?: string;
  };
  renderCheck?: (doc: unknown) => Promise<RenderCheckResult>;
}
