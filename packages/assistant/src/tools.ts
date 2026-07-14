/**
 * Tools.js — Jx document manipulation tools for the AI assistant
 *
 * Concrete `.jx` AST tools registered into a `@jxsuite/ai` ToolRegistry. Each tool calls through the
 * injected `AssistantHost` — never `tabs/transact`/`Tab` directly — so edits get the same undo/redo
 * history as manual edits in whichever host wires this package up (ADR
 * docs/ai-assistant-decision.md §5 — optimistic apply + undo; specs/ai-assistant.md §11.3).
 *
 * @license MIT
 */

import { createToolDefinition } from "@jxsuite/ai/tools";
import type { ToolRegistry, ToolResult } from "@jxsuite/ai/tools";
import type { JxMutableNode, JxPath, JxStateDefinition } from "@jxsuite/schema/types";
import type { AssistantHost } from "./host";
import { validateDoc } from "./validate";
import { flagHardcodedTokens, formatTokenHints } from "./token-lint";

const PATH_DESCRIPTION =
  "Path to a node in the document, as a JSON array of keys/indices from the root " +
  '(e.g. ["children", 0, "children", 1]). Use read_document to discover valid paths.';

/**
 * Translate a raw JSON Schema validation error into a Jx-specific actionable message. The LLM needs
 * concrete guidance on HOW to fix errors, not just what rule was violated.
 *
 * @param {string} rawError - Message from ajv (e.g. "/children/0/style: must NOT have additional
 *   property")
 * @returns {string}
 */
function translateValidationError(rawError: string): string {
  const lower = rawError.toLowerCase();

  // Additional property — extract the offending key from the message if present
  if (
    lower.includes("must not have additional property") ||
    lower.includes("additional properties")
  ) {
    return `${rawError}\n  → Fix: Remove or move the unexpected property. Style properties must be camelCase (e.g. "backgroundColor", not "background-color"). Non-IDL HTML attributes (aria-*, data-*, role, ...) must go inside an "attributes" object: { "attributes": { "aria-label": "..." } }.`;
  }

  // Pattern — usually tagName hyphen rule
  if (lower.includes("must match pattern")) {
    return `${rawError}\n  → Fix: Custom element tag names must contain a hyphen (e.g. "newsletter-form", "feature-card"). Standard HTML elements use their exact name (e.g. "div", "input", "button").`;
  }

  // Type error
  if (lower.includes("must be string")) {
    return `${rawError}\n  → Fix: Wrap the value in quotes — all Jx property values should be strings. For example, use "10px" (string) not 10px (unquoted).`;
  }

  if (lower.includes("must be number") || lower.includes("must be integer")) {
    return `${rawError}\n  → Fix: Remove quotes from the numeric value — it should be a plain number, not a string.`;
  }

  if (lower.includes("must be object") || lower.includes("must be array")) {
    return `${rawError}\n  → Fix: The value must be an object/array (use {} or []), not a string or number.`;
  }

  if (lower.includes("must be boolean")) {
    return `${rawError}\n  → Fix: Use true or false without quotes for boolean values.`;
  }

  // Required property
  if (lower.includes("must have required property")) {
    return `${rawError}\n  → Fix: Add the missing required property. Every Jx element must have at least a "tagName" field.`;
  }

  // Enum / allowed values
  if (lower.includes("must be equal to one of the allowed values")) {
    return `${rawError}\n  → Fix: Change the value to one of the allowed options listed in the error.`;
  }

  return rawError;
}

/**
 * Apply a mutation, then validate the document and report only the schema errors the edit newly
 * introduced (the eval signal — ADR §6b). The change stays applied either way (optimistic apply +
 * undo, ADR §5); reporting the errors lets the agent loop self-correct on the next round.
 *
 * When the host has a `renderCheck` capability, a second gate runs after schema validation passes:
 * the mutated document is rendered in a detached context and any render-time throws are surfaced as
 * tool errors (same contract as schema errors).
 *
 * @param {AssistantHost} host
 * @param {() => void} mutationFn - Performs one `host.document.*` mutation.
 * @param {string} summary
 * @param {(doc: unknown) => Promise<string[]>} validate
 * @returns {Promise<ToolResult>}
 */
async function applyAndValidate(
  host: AssistantHost,
  mutationFn: () => void,
  summary: string,
  validate: (doc: unknown) => Promise<string[]>,
): Promise<ToolResult> {
  const rawBefore = host.document.getDocument();
  const before = new Set(await validate(rawBefore));
  const renderOkBefore = host.renderCheck ? await host.renderCheck(rawBefore) : { ok: true };

  mutationFn();

  const rawAfter = host.document.getDocument();
  const after = await validate(rawAfter);
  const newErrors = after.filter((e) => !before.has(e));
  if (newErrors.length > 0) {
    const formatted = newErrors.map((e) => `- ${translateValidationError(e)}`).join("\n");
    return {
      success: false,
      error: `Change applied, but it introduced schema errors. Fix these issues with follow-up edits:\n${formatted}`,
    };
  }

  if (host.renderCheck && renderOkBefore.ok) {
    const renderResult = await host.renderCheck(rawAfter);
    if (!renderResult.ok) {
      return {
        success: false,
        error: `Change applied and schema-valid, but it broke rendering. Fix with follow-up edits:\n- ${renderResult.error}`,
      };
    }
  }

  // Soft token-discipline hints (never fail the mutation)
  const { projectStyle } = host.project ?? {};
  if (projectStyle) {
    const findings = flagHardcodedTokens(rawAfter as JxMutableNode, projectStyle);
    const hints = formatTokenHints(findings);
    if (hints) {
      return { success: true, summary: `${summary}\n\n${hints}` };
    }
  }

  return { success: true, summary };
}

/**
 * Register the document-manipulation tools into a tool registry. Every tool is always registered; a
 * tool whose backing host capability is absent (`host.files`, `host.renderCheck`) returns `{
 * success: false, error: "<X> is not available in this environment." }` at call time rather than
 * being omitted, so the model always sees the same tool list (§11.3).
 *
 * @param {Pick<ToolRegistry, "register">} registry
 * @param {AssistantHost} host
 */
export function registerAiTools(registry: Pick<ToolRegistry, "register">, host: AssistantHost) {
  const validate = host.validation?.validate ?? validateDoc;

  registry.register(
    createToolDefinition({
      name: "read_document",
      description:
        "Read the current Jx document, or the subtree at a given path. Use this to discover " +
        "node paths before calling set_property, add_child, or remove_node.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "array",
            description: `${PATH_DESCRIPTION} Omit to read the whole document.`,
            items: { type: ["string", "number"] },
          },
        },
        required: [],
      },
      execute(args) {
        const doc = host.document.getDocument();
        if (!doc) {
          return { success: false, error: "No document is open." };
        }
        const { path } = args as { path?: JxPath };
        const node = path && path.length > 0 ? host.document.getNodeAtPath(path) : doc;
        if (node === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(path)}.` };
        }
        return { success: true, data: node };
      },
    }),
  );

  registry.register(
    createToolDefinition({
      name: "set_property",
      description:
        "Set or remove a property on a node (e.g. tagName, textContent, className, style, " +
        "attributes, $props). Pass value: null to remove the property.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "array",
            description: PATH_DESCRIPTION,
            items: { type: ["string", "number"] },
          },
          key: {
            type: "string",
            description: 'The property name to set, e.g. "textContent" or "className".',
          },
          value: {
            description: "The new value, or null to remove the property.",
          },
        },
        /*
         * "value" omitted from required: passing null / omitting it means "remove the property",
         * but the registry rejects null on required args (tools.js:181). See §14.
         */
        required: ["path", "key"],
      },
      async execute(args) {
        if (!host.document.getDocument()) {
          return { success: false, error: "No document is open." };
        }
        const { path, key, value } = args as { path: JxPath; key: string; value?: unknown };
        const node = host.document.getNodeAtPath(path);
        if (node === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(path)}.` };
        }
        return applyAndValidate(
          host,
          () => host.document.updateProperty(path, key, value ?? undefined),
          `Set "${key}" at ${JSON.stringify(path)}.`,
          validate,
        );
      },
    }),
  );

  registry.register(
    createToolDefinition({
      name: "add_child",
      description:
        "Insert a new child node into the children array of the node at parentPath, at the " +
        "given index (0 = first child). The node definition follows the Jx document schema " +
        '(e.g. { "tagName": "p", "textContent": "Hello" }).',
      parameters: {
        type: "object",
        properties: {
          parentPath: {
            type: "array",
            description: `${PATH_DESCRIPTION} Must point at a node, not a children array.`,
            items: { type: ["string", "number"] },
          },
          index: { type: "integer", description: "Position in the children array to insert at." },
          node: {
            type: "object",
            description:
              'The Jx node definition to insert, e.g. { "tagName": "div", "children": [] }.',
          },
        },
        required: ["parentPath", "index", "node"],
      },
      async execute(args) {
        if (!host.document.getDocument()) {
          return { success: false, error: "No document is open." };
        }
        const {
          parentPath,
          index,
          node: childNode,
        } = args as {
          parentPath: JxPath;
          index: number;
          node: JxMutableNode;
        };
        const parent = host.document.getNodeAtPath(parentPath);
        if (parent === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(parentPath)}.` };
        }
        /*
         * Guard against a parentPath that points at a children *array* rather than a node — the
         * common failure is a trailing "children" segment (e.g. ["children",0,"children"]).
         * add_child appends "children" + index itself, so an array-valued parentPath would splice
         * into a bogus `.children` property on the array and the node would be stored where
         * nothing renders, yet the tool would report success. Reject it with a precise message so
         * the loop self-corrects.
         */
        if (Array.isArray(parent)) {
          return {
            success: false,
            error:
              `parentPath ${JSON.stringify(parentPath)} points at a children array, not a node. ` +
              `Drop the trailing "children" segment — add_child appends "children" and the index ` +
              `automatically. For example, to insert into the node at ["children",0,"children",1], ` +
              `pass parentPath: ["children",0,"children",1].`,
          };
        }
        const parentNode = parent as JxMutableNode;
        if (parentNode.children !== undefined && !Array.isArray(parentNode.children)) {
          return {
            success: false,
            error: "Cannot insert into mapped-array children; edit the map template instead.",
          };
        }
        return applyAndValidate(
          host,
          () => host.document.insertNode(parentPath, index, childNode),
          `Inserted node at ${JSON.stringify([...parentPath, "children", index])}.`,
          validate,
        );
      },
    }),
  );

  // ── set_style ──────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "set_style",
      description:
        "Set or remove a CSS style property on a node. Style property names use camelCase " +
        '(e.g. "backgroundColor", "fontSize", "borderRadius"). Values are always strings ' +
        '(e.g. "10px", "center", "var(--color-accent)"). Pass value: null to remove.',
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "array",
            description: PATH_DESCRIPTION,
            items: { type: ["string", "number"] },
          },
          property: {
            type: "string",
            description: 'CSS property name in camelCase, e.g. "backgroundColor".',
          },
          value: {
            description:
              'CSS value as a string (e.g. "10px", "var(--color-accent)"), or null to remove.',
          },
        },
        /*
         * "value" omitted from required so null / omitted = remove (registry rejects null on
         * required args, tools.js:181). See §14.
         */
        required: ["path", "property"],
      },
      async execute(args) {
        if (!host.document.getDocument()) {
          return { success: false, error: "No document is open." };
        }
        const { path, property, value } = args as {
          path: JxPath;
          property: string;
          value?: unknown;
        };
        if (host.document.getNodeAtPath(path) === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(path)}.` };
        }
        const prop = property;
        const val = value == null ? undefined : String(value);
        return applyAndValidate(
          host,
          () => host.document.updateStyle(path, prop, val),
          `Set style "${prop}" at ${JSON.stringify(path)}.`,
          validate,
        );
      },
    }),
  );

  // ── set_text ───────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "set_text",
      description:
        "Set the textContent of a node. Convenience alias for set_property with key: 'textContent'.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "array",
            description: PATH_DESCRIPTION,
            items: { type: ["string", "number"] },
          },
          value: { type: "string", description: "Text content." },
        },
        required: ["path", "value"],
      },
      async execute(args) {
        if (!host.document.getDocument()) {
          return { success: false, error: "No document is open." };
        }
        const { path, value } = args as { path: JxPath; value: string };
        if (host.document.getNodeAtPath(path) === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(path)}.` };
        }
        return applyAndValidate(
          host,
          () => host.document.setText(path, value),
          `Set text at ${JSON.stringify(path)}.`,
          validate,
        );
      },
    }),
  );

  // ── add_state ──────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "add_state",
      description:
        "Add a new reactive state variable under the document's `state` object. The value can be a scalar " +
        '(e.g. 0, ""), a typed object ({ "type": "string", "default": "" }), a computed ' +
        'string ("${state.other}"), a function ({ "$prototype": "Function", "body": "..." }), ' +
        'or a data source ({ "$prototype": "Data", "$src": "./data.json" }).',
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: 'State variable name, e.g. "count", "isOpen".' },
          value: {
            description:
              "Initial value or state shape object (scalar, typed, computed, function, or data source).",
          },
        },
        required: ["key", "value"],
      },
      async execute(args) {
        const doc = host.document.getDocument();
        if (!doc) {
          return { success: false, error: "No document is open." };
        }
        const { key, value } = args as { key: string; value: JxStateDefinition };
        const docState = (doc as JxMutableNode).state;
        if (docState && docState[key] !== undefined) {
          return {
            success: false,
            error: `State key "${key}" already exists. Use update_state to change it, or remove it first.`,
          };
        }
        return applyAndValidate(
          host,
          () => host.document.updateState(key, value),
          `Added state "${key}".`,
          validate,
        );
      },
    }),
  );

  // ── update_state ───────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "update_state",
      description:
        "Update or remove an existing state variable at the document root. Pass value: null to remove.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: 'State variable name to update, e.g. "count".' },
          value: {
            description:
              "New value (same shapes as add_state), or null to remove the state variable.",
          },
        },
        /*
         * "value" omitted from required so null = remove (registry rejects null on required
         * args, tools.js:181). See §14.
         */
        required: ["key"],
      },
      async execute(args) {
        const doc = host.document.getDocument();
        if (!doc) {
          return { success: false, error: "No document is open." };
        }
        const { key, value } = args as { key: string; value?: JxStateDefinition | null };
        const docState = (doc as JxMutableNode).state;
        if (!docState || docState[key] === undefined) {
          return {
            success: false,
            error: `State key "${key}" does not exist. Use add_state to create it, or check the name. Current state keys: ${Object.keys(docState || {}).join(", ") || "(none)"}`,
          };
        }
        return applyAndValidate(
          host,
          () => host.document.updateState(key, value == null ? undefined : value),
          value == null ? `Removed state "${key}".` : `Updated state "${key}".`,
          validate,
        );
      },
    }),
  );

  // ── move_node ──────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "move_node",
      description:
        "Move a node from one location to another in the document tree. The node is removed " +
        "from fromPath and inserted into toParentPath at toIndex.",
      parameters: {
        type: "object",
        properties: {
          fromPath: {
            type: "array",
            description: `${PATH_DESCRIPTION} The node to move.`,
            items: { type: ["string", "number"] },
          },
          toParentPath: {
            type: "array",
            description: `${PATH_DESCRIPTION} The target parent (a node, not a children array).`,
            items: { type: ["string", "number"] },
          },
          toIndex: {
            type: "integer",
            description: "Insertion index in the target parent's children array.",
          },
        },
        required: ["fromPath", "toParentPath", "toIndex"],
      },
      async execute(args) {
        if (!host.document.getDocument()) {
          return { success: false, error: "No document is open." };
        }
        const { fromPath, toParentPath, toIndex } = args as {
          fromPath: JxPath;
          toParentPath: JxPath;
          toIndex: number;
        };
        if (fromPath.length < 2) {
          return { success: false, error: "Cannot move the document root." };
        }
        if (host.document.getNodeAtPath(fromPath) === undefined) {
          return {
            success: false,
            error: `No node exists at fromPath ${JSON.stringify(fromPath)}.`,
          };
        }
        if (host.document.getNodeAtPath(toParentPath) === undefined) {
          return {
            success: false,
            error: `No node exists at toParentPath ${JSON.stringify(toParentPath)}.`,
          };
        }
        return applyAndValidate(
          host,
          () => host.document.moveNode(fromPath, toParentPath, toIndex),
          `Moved node from ${JSON.stringify(fromPath)} to ${JSON.stringify([...toParentPath, "children", toIndex])}.`,
          validate,
        );
      },
    }),
  );

  // ── create_component ───────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "create_component",
      description:
        "Create a new Jx component file on disk. Writes the component JSON to the given " +
        "relative path within the project. The content must be a valid Jx component document.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'File path relative to the project root, e.g. "components/newsletter-form.json".',
          },
          content: {
            type: "object",
            description:
              "The complete Jx component JSON (must include tagName, optionally state, style, children, $elements).",
          },
        },
        required: ["path", "content"],
      },
      async execute(args) {
        if (!host.files) {
          return {
            success: false,
            error: "File operations are not available in this environment.",
          };
        }
        const { path: relPath, content } = args as { path: string; content: object };
        const errors = await validate(content);
        if (errors.length > 0) {
          const formatted = errors.map((e) => `- ${translateValidationError(e)}`).join("\n");
          return {
            success: false,
            error: `Component content has schema errors. Fix these before creating the file:\n${formatted}`,
          };
        }
        if (host.renderCheck) {
          const renderResult = await host.renderCheck(content);
          if (!renderResult.ok) {
            return {
              success: false,
              error: `Component is schema-valid but fails to render. Fix before creating:\n- ${renderResult.error}`,
            };
          }
        }
        try {
          await host.files.saveFile(relPath, JSON.stringify(content, null, 2));
          return { success: true, summary: `Created component at "${relPath}".` };
        } catch (error) {
          return {
            success: false,
            error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  );

  // ── create_page ────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "create_page",
      description:
        "Create a new Jx page file on disk. A page typically includes a layout component and " +
        "section children. The content must be a valid Jx page document.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'File path relative to the project root, e.g. "pages/about.json".',
          },
          content: {
            type: "object",
            description:
              "The complete Jx page JSON (typically includes $elements to import a layout, children for sections).",
          },
        },
        required: ["path", "content"],
      },
      async execute(args) {
        if (!host.files) {
          return {
            success: false,
            error: "File operations are not available in this environment.",
          };
        }
        const { path: relPath, content } = args as { path: string; content: object };
        const errors = await validate(content);
        if (errors.length > 0) {
          const formatted = errors.map((e) => `- ${translateValidationError(e)}`).join("\n");
          return {
            success: false,
            error: `Page content has schema errors. Fix these before creating the file:\n${formatted}`,
          };
        }
        if (host.renderCheck) {
          const renderResult = await host.renderCheck(content);
          if (!renderResult.ok) {
            return {
              success: false,
              error: `Page is schema-valid but fails to render. Fix before creating:\n- ${renderResult.error}`,
            };
          }
        }
        try {
          await host.files.saveFile(relPath, JSON.stringify(content, null, 2));
          return { success: true, summary: `Created page at "${relPath}".` };
        } catch (error) {
          return {
            success: false,
            error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  );

  // ── open_document ─────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "open_document",
      description:
        "Switch the active document to another file in the project. After opening, all " +
        "tools (read_document, set_property, add_child, etc.) operate on the newly-active " +
        "document. Use this to iteratively refine pages or components after creating them " +
        "with create_page or create_component.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'File path relative to the project root, e.g. "pages/about.json" or ' +
              '"components/nav-bar.json". Must be an existing file.',
          },
        },
        required: ["path"],
      },
      async execute(args) {
        if (!host.files) {
          return {
            success: false,
            error: "File navigation is not available in this environment.",
          };
        }
        const { path: relPath } = args as { path: string };
        try {
          await host.files.openDocument(relPath);
          if (!host.document.getDocument()) {
            return {
              success: false,
              error: `File "${relPath}" could not be opened — no active tab after navigation.`,
            };
          }
          /*
           * The agent loop opens a single undo batch on the document active at loop start
           * (agent-loop.js → host.document.beginBatch()). Switching the active document mid-loop
           * would strand the new document's edits with no history snapshot — undo would have
           * nothing to roll back. Flush the previous document's batch and re-open one on the
           * newly-active document so edits in each document remain individually undoable.
           */
          if (host.document.isBatching()) {
            host.document.endBatch();
            host.document.beginBatch();
          }
          return {
            success: true,
            summary: `Switched to "${relPath}". All tools now operate on this document.`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to open "${relPath}": ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  );

  // ── get_selection ──────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "get_selection",
      description:
        "Get the node currently selected in the canvas, if any. Returns its path and tagName, " +
        "or null if nothing is selected. Use this before an ambiguous request like 'make this " +
        "bigger' or 'change its color' to find out which node the user means.",
      parameters: { type: "object", properties: {}, required: [] },
      execute() {
        if (!host.perception) {
          return {
            success: false,
            error: "Canvas perception is not available in this environment.",
          };
        }
        const path = host.perception.getSelection();
        if (!path) {
          return { success: true, data: null, summary: "Nothing is currently selected." };
        }
        const node = host.document.getNodeAtPath(path) as JxMutableNode | undefined;
        return { success: true, data: { path, tagName: node?.tagName ?? "element" } };
      },
    }),
  );

  // ── describe_canvas ────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "describe_canvas",
      description:
        "Get a summary of what's actually rendered on the canvas right now: each visible " +
        "node's path, tag, on-screen rect, a short text snippet, and whether it's hidden. Use " +
        "this to check ground truth against the document tree — e.g. a node with hidden: true, " +
        "or which $switch case is actually active — and to spot existing components you can " +
        "reuse instead of re-authoring equivalent markup.",
      parameters: {
        type: "object",
        properties: {
          root: {
            type: "array",
            description: `${PATH_DESCRIPTION} Omit to describe the whole rendered canvas.`,
            items: { type: ["string", "number"] },
          },
        },
        required: [],
      },
      async execute(args) {
        if (!host.perception) {
          return {
            success: false,
            error: "Canvas perception is not available in this environment.",
          };
        }
        const { root } = args as { root?: JxPath };
        const nodes = await host.perception.getRenderedTree(root ? { root } : undefined);
        return { success: true, data: nodes };
      },
    }),
  );

  // ── measure_nodes ───────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "measure_nodes",
      description:
        "Get the current on-screen rect (x, y, width, height) of one or more nodes by path. " +
        "Use this before a size/layout-aware edit — e.g. 'make this button larger' needs to " +
        "know its current size first.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            description: "One or more node paths to measure.",
            items: { type: "array", items: { type: ["string", "number"] } },
          },
        },
        required: ["paths"],
      },
      async execute(args) {
        if (!host.perception) {
          return {
            success: false,
            error: "Canvas perception is not available in this environment.",
          };
        }
        const { paths } = args as { paths: JxPath[] };
        const rects = await host.perception.measure(paths);
        return { success: true, data: rects };
      },
    }),
  );

  registry.register(
    createToolDefinition({
      name: "remove_node",
      description: "Remove the node at the given path from its parent's children array.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "array",
            description: `${PATH_DESCRIPTION} Cannot be the document root.`,
            items: { type: ["string", "number"] },
          },
        },
        required: ["path"],
      },
      async execute(args) {
        if (!host.document.getDocument()) {
          return { success: false, error: "No document is open." };
        }
        const { path } = args as { path: JxPath };
        if (path.length < 2) {
          return { success: false, error: "Cannot remove the document root." };
        }
        if (host.document.getNodeAtPath(path) === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(path)}.` };
        }
        return applyAndValidate(
          host,
          () => host.document.removeNode(path),
          `Removed node at ${JSON.stringify(path)}.`,
          validate,
        );
      },
    }),
  );
}
