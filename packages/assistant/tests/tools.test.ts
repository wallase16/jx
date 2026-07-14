import { describe, expect, test } from "bun:test";
import { createToolRegistry } from "@jxsuite/ai";
import { registerAiTools } from "../src/tools";
import { createFakeHost } from "./fake-host";
import type { FakeHostOptions } from "./fake-host";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** Build a fake host + registry with a no-op validator so tests assert mutation, not schema. */
function harness(doc: Record<string, unknown> | null, opts: FakeHostOptions = {}) {
  const { host, getDoc, batch } = createFakeHost(doc, { validate: async () => [], ...opts });
  const registry = createToolRegistry();
  registerAiTools(registry, host);
  return { registry, getDoc, host, batch };
}

/** Execute a tool and return only its error message (keeps assertions off await-member access). */
async function execErr(
  registry: ReturnType<typeof createToolRegistry>,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await registry.execute(name, args);
  return result.error;
}

describe("tools — state tools (§14.1 regression)", () => {
  test("add_state writes under document.state, NOT the document root", async () => {
    const { registry, getDoc } = harness({
      tagName: "x-comp",
      state: { existing: 1 },
      children: [],
    });

    const res = await registry.execute("add_state", { key: "count", value: 0 });

    expect(res.success).toBe(true);
    expect(getDoc().state!.count).toBe(0); // Correct location
    expect(getDoc().count).toBeUndefined(); // NOT the root (the original bug)
  });

  test("add_state creates the state object when the document has none", async () => {
    const { registry, getDoc } = harness({ tagName: "x-comp", children: [] });

    const res = await registry.execute("add_state", { key: "isOpen", value: false });

    expect(res.success).toBe(true);
    expect(getDoc().state!.isOpen).toBe(false);
  });

  test("add_state preserves an empty-string default (not deleted)", async () => {
    const { registry, getDoc } = harness({ tagName: "x-comp", children: [] });

    const res = await registry.execute("add_state", { key: "title", value: "" });

    expect(res.success).toBe(true);
    expect(getDoc().state).toHaveProperty("title");
    expect(getDoc().state!.title).toBe("");
  });

  test("add_state rejects a duplicate key", async () => {
    const { registry, getDoc } = harness({ tagName: "x-comp", state: { count: 0 }, children: [] });

    const res = await registry.execute("add_state", { key: "count", value: 5 });

    expect(res.success).toBe(false);
    expect(getDoc().state!.count).toBe(0); // Unchanged
  });

  test("update_state changes an existing key", async () => {
    const { registry, getDoc } = harness({ tagName: "x-comp", state: { count: 0 }, children: [] });

    await registry.execute("update_state", { key: "count", value: 10 });
    expect(getDoc().state!.count).toBe(10);
  });

  test("update_state removes a key when value is null", async () => {
    const { registry, getDoc } = harness({ tagName: "x-comp", state: { count: 0 }, children: [] });

    const res = await registry.execute("update_state", { key: "count", value: null });

    expect(res.success).toBe(true);
    expect(getDoc().state).not.toHaveProperty("count");
  });

  test("update_state errors on an unknown key", async () => {
    const { registry } = harness({ tagName: "x-comp", state: {}, children: [] });

    const res = await registry.execute("update_state", { key: "ghost", value: 1 });

    expect(res.success).toBe(false);
  });
});

describe("tools — style & structure", () => {
  test("set_style sets a CSS property on a node", async () => {
    const { registry, getDoc } = harness({ tagName: "div", children: [] });

    const res = await registry.execute("set_style", {
      path: [],
      property: "backgroundColor",
      value: "var(--color-accent)",
    });

    expect(res.success).toBe(true);
    expect(getDoc().style!.backgroundColor).toBe("var(--color-accent)");
  });

  test("set_style removes a property when value is null", async () => {
    const { registry, getDoc } = harness({ tagName: "div", style: { color: "red" }, children: [] });

    const res = await registry.execute("set_style", { path: [], property: "color", value: null });

    expect(res.success).toBe(true);
    expect(getDoc().style?.color).toBeUndefined();
  });

  test("move_node relocates a node between parents", async () => {
    const { registry, getDoc } = harness({
      tagName: "div",
      children: [
        { tagName: "section", children: [{ tagName: "p", textContent: "move me" }] },
        { tagName: "aside", children: [] },
      ],
    });

    const res = await registry.execute("move_node", {
      fromPath: ["children", 0, "children", 0],
      toParentPath: ["children", 1],
      toIndex: 0,
    });

    expect(res.success).toBe(true);
    const moveChildren = getDoc().children as JxMutableNode[];
    expect(moveChildren[0]!.children).toHaveLength(0);
    expect((moveChildren[1]!.children as JxMutableNode[])[0]!.tagName).toBe("p");
  });

  test("move_node refuses to move the document root", async () => {
    const { registry } = harness({ tagName: "div", children: [] });

    const res = await registry.execute("move_node", {
      fromPath: [],
      toParentPath: [],
      toIndex: 0,
    });

    expect(res.success).toBe(false);
  });

  test("move_node rejects a bad fromPath or toParentPath", async () => {
    const { registry } = harness({
      tagName: "div",
      children: [{ tagName: "p" }],
    });

    expect(
      await execErr(registry, "move_node", {
        fromPath: ["children", 9],
        toParentPath: [],
        toIndex: 0,
      }),
    ).toContain("No node exists at fromPath");

    expect(
      await execErr(registry, "move_node", {
        fromPath: ["children", 0],
        toParentPath: ["children", 9],
        toIndex: 0,
      }),
    ).toContain("No node exists at toParentPath");
  });

  test("add_child appends a node to the parent's children", async () => {
    const { registry, getDoc } = harness({
      tagName: "ul",
      children: [{ tagName: "li", textContent: "one" }],
    });

    const res = await registry.execute("add_child", {
      parentPath: [],
      index: 1,
      node: { tagName: "li", textContent: "two" },
    });

    expect(res.success).toBe(true);
    expect(getDoc().children).toHaveLength(2);
    expect((getDoc().children as JxMutableNode[])[1]!.textContent).toBe("two");
  });

  test("add_child rejects a parentPath that points at a children array (trailing 'children')", async () => {
    // Regression (L6.3/L6.7): the model appended a trailing "children" segment, so parentPath
    // Resolved to the children array, not the node. The old code silently tacked a bogus
    // `.children` onto the array and reported success — the node never rendered.
    const { registry, getDoc } = harness({
      tagName: "div",
      children: [{ tagName: "ul", children: [{ tagName: "li", textContent: "one" }] }],
    });

    const res = await registry.execute("add_child", {
      parentPath: ["children", 0, "children"], // <- points at the <ul>'s children array
      index: 1,
      node: { tagName: "li", textContent: "two" },
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("children array");
    // The bogus insert must NOT have happened: the real children array is untouched...
    const ulNode = (getDoc().children as JxMutableNode[])[0]!;
    expect(ulNode.children).toHaveLength(1);
    // ...and no `.children` property was tacked onto the array object.
    expect((ulNode.children as unknown as Record<string, unknown>).children).toBeUndefined();
  });

  test("add_child rejects a missing parentPath and a mapped-array children parent", async () => {
    const { registry } = harness({ tagName: "div", children: [] });
    expect(
      await execErr(registry, "add_child", {
        parentPath: ["children", 9],
        index: 0,
        node: { tagName: "p" },
      }),
    ).toContain("No node exists at path");

    const { registry: r2 } = harness({
      tagName: "div",
      children: [
        {
          // Legacy whole-children repeater: children is the $prototype: "Array" object itself,
          // Not an array containing it — add_child must reject inserting into this parent.
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/items" },
            map: { tagName: "li" },
          },
          tagName: "ul",
        },
      ],
    });
    expect(
      await execErr(r2, "add_child", {
        parentPath: ["children", 0],
        index: 0,
        node: { tagName: "li" },
      }),
    ).toContain("mapped-array children");
  });

  test("set_style rejects an invalid path", async () => {
    const { registry } = harness({ tagName: "div", children: [] });
    expect(
      await execErr(registry, "set_style", {
        path: ["children", 9],
        property: "color",
        value: "red",
      }),
    ).toContain("No node exists");
  });
});

describe("tools — open_document", () => {
  test("open_document switches the active document via the files capability", async () => {
    let openedPath: string | null = null;

    const { registry, getDoc } = harness(
      { tagName: "div", children: [] },
      {
        openDocument: async (path: string) => {
          openedPath = path;
        },
      },
    );

    const res = await registry.execute("open_document", { path: "pages/about.json" });

    expect(res.success).toBe(true);
    expect(openedPath as string | null).toBe("pages/about.json");
    expect(res.summary).toContain("pages/about.json");
    expect(getDoc()).toBeTruthy(); // Fake host's document is unaffected by openDocument itself
  });

  test("open_document errors when the files capability is not available", async () => {
    const { registry } = harness({ tagName: "div", children: [] });

    const res = await registry.execute("open_document", { path: "pages/about.json" });

    expect(res.success).toBe(false);
    expect(res.error).toContain("not available");
  });

  test("open_document surfaces file-not-found errors", async () => {
    const { registry } = harness(
      { tagName: "div", children: [] },
      {
        openDocument: async () => {
          throw new Error("File not found: pages/missing.json");
        },
      },
    );

    const res = await registry.execute("open_document", { path: "pages/missing.json" });

    expect(res.success).toBe(false);
    expect(res.error).toContain("File not found");
  });

  test("open_document reports when navigation leaves no active document", async () => {
    // The fake host's document never changes on openDocument() (it only records the call), so
    // Starting from noDocument: true reproduces "no active tab after navigation" exactly.
    const { registry } = harness(null, {
      noDocument: true,
      openDocument: async () => {},
    } as unknown as FakeHostOptions);

    const res = await registry.execute("open_document", { path: "p.json" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("no active tab");
  });

  test("open_document leaves batching alone when no batch is open", async () => {
    const { registry, batch } = harness(
      { tagName: "div", children: [] },
      { openDocument: async () => {} },
    );

    const res = await registry.execute("open_document", { path: "pages/about.json" });
    expect(res.success).toBe(true);
    // IsBatching() was false (no outer batch open), so the tool must not open one itself.
    expect(batch.begins).toBe(0);
    expect(batch.ends).toBe(0);
  });

  test("open_document flushes and re-opens an in-progress batch (mid-loop tab switch)", async () => {
    const { registry, host, batch } = harness(
      { tagName: "div", children: [] },
      { openDocument: async () => {} },
    );

    // Simulate the agent loop having opened a batch before this tool call.
    host.document.beginBatch();
    expect(batch.begins).toBe(1);

    const res = await registry.execute("open_document", { path: "pages/about.json" });
    expect(res.success).toBe(true);
    // The tool flushed the open batch (endBatch) and re-opened one on the new document.
    expect(batch.ends).toBe(1);
    expect(batch.begins).toBe(2);
    expect(host.document.isBatching()).toBe(true);
  });
});

describe("tools — read & inspect", () => {
  test("read_document returns the whole tree, a subtree, and reports bad paths", async () => {
    const { registry } = harness({
      children: [{ tagName: "p", textContent: "hi" }],
      tagName: "div",
    });
    const whole = await registry.execute("read_document", {});
    expect(whole.success).toBe(true);
    expect((whole.data as JxMutableNode).tagName).toBe("div");

    const sub = await registry.execute("read_document", { path: ["children", 0] });
    expect((sub.data as JxMutableNode).tagName).toBe("p");

    const bad = await registry.execute("read_document", { path: ["children", 9] });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("No node exists");
  });

  test("tools report when no document is open", async () => {
    const { registry } = harness(null, { noDocument: true } as unknown as FakeHostOptions);
    expect(await execErr(registry, "read_document", {})).toContain("No document is open");
    expect(await execErr(registry, "set_property", { key: "id", path: [], value: "x" })).toContain(
      "No document is open",
    );
    expect(
      await execErr(registry, "add_child", { parentPath: [], index: 0, node: { tagName: "p" } }),
    ).toContain("No document is open");
    expect(
      await execErr(registry, "set_style", { path: [], property: "color", value: "red" }),
    ).toContain("No document is open");
    expect(await execErr(registry, "set_text", { path: [], value: "x" })).toContain(
      "No document is open",
    );
    expect(await execErr(registry, "add_state", { key: "x", value: 1 })).toContain(
      "No document is open",
    );
    expect(await execErr(registry, "update_state", { key: "x", value: 1 })).toContain(
      "No document is open",
    );
    expect(
      await execErr(registry, "move_node", {
        fromPath: ["children", 0],
        toParentPath: [],
        toIndex: 0,
      }),
    ).toContain("No document is open");
    expect(await execErr(registry, "remove_node", { path: ["children", 0] })).toContain(
      "No document is open",
    );
  });
});

describe("tools — set_property / set_text / remove_node", () => {
  test("set_property sets and removes a property", async () => {
    const { registry, getDoc } = harness({ id: "old", tagName: "div", children: [] });
    const set = await registry.execute("set_property", { key: "id", path: [], value: "new" });
    expect(set.success).toBe(true);
    expect(getDoc().id).toBe("new");

    const removed = await registry.execute("set_property", { key: "id", path: [] });
    expect(removed.success).toBe(true);
    expect(getDoc().id).toBeUndefined();
  });

  test("set_property and set_text reject an invalid path", async () => {
    const { registry } = harness({ tagName: "div", children: [] });
    expect(
      await execErr(registry, "set_property", { key: "id", path: ["children", 5], value: "x" }),
    ).toContain("No node exists");
    expect(await execErr(registry, "set_text", { path: ["children", 5], value: "x" })).toContain(
      "No node exists",
    );
  });

  test("set_text replaces a node's children with the text", async () => {
    const { registry, getDoc } = harness({
      children: [{ tagName: "p", textContent: "old" }],
      tagName: "div",
    });
    const res = await registry.execute("set_text", { path: ["children", 0], value: "fresh" });
    expect(res.success).toBe(true);
    const p = (getDoc().children as JxMutableNode[])[0]!;
    expect((p.children as string[])[0]).toBe("fresh");
  });

  test("remove_node deletes a child, refuses the root, and rejects bad paths", async () => {
    const { registry, getDoc } = harness({
      children: [{ tagName: "p" }, { tagName: "span" }],
      tagName: "div",
    });
    const res = await registry.execute("remove_node", { path: ["children", 0] });
    expect(res.success).toBe(true);
    expect((getDoc().children as JxMutableNode[])[0]!.tagName).toBe("span");

    expect(await execErr(registry, "remove_node", { path: [] })).toContain(
      "Cannot remove the document root",
    );
    expect(await execErr(registry, "remove_node", { path: ["children", 9] })).toContain(
      "No node exists",
    );
  });
});

describe("tools — validation feedback & render gate", () => {
  test("translateValidationError adds a targeted fix hint per error pattern", async () => {
    const schemaErrors = [
      "/style: must NOT have additional property",
      "/tagName: must match pattern",
      "/a: must be string",
      "/b: must be number",
      "/c: must be object",
      "/d: must be boolean",
      "root: must have required property 'tagName'",
      "/e: must be equal to one of the allowed values",
      "/f: some unrecognized error",
    ];
    const { registry } = harness(
      { tagName: "div", children: [] },
      { saveFile: async () => {}, validate: async () => schemaErrors },
    );
    const res = await registry.execute("create_component", {
      content: { tagName: "bad" },
      path: "components/bad.json",
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("→ Fix:");
    expect(res.error).toContain("camelCase");
    expect(res.error).toContain("must contain a hyphen");
    expect(res.error).toContain("/f: some unrecognized error"); // Fallthrough kept verbatim
  });

  test("a mutation that introduces new schema errors is reported with fixes", async () => {
    let call = 0;
    const validate = async () => {
      call += 1;
      return call === 1 ? [] : ["/tagName: must match pattern"]; // Before clean, after dirty
    };
    const { registry } = harness({ tagName: "div", children: [] }, { validate });
    const res = await registry.execute("set_property", { key: "tagName", path: [], value: "x" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("introduced schema errors");
    expect(res.error).toContain("→ Fix:");
  });

  test("a schema-valid mutation that breaks rendering is reported", async () => {
    let call = 0;
    const renderCheck = async () => {
      call += 1;
      return call === 1 ? ({ ok: true } as const) : ({ error: "render boom", ok: false } as const);
    };
    const { registry } = harness(
      { tagName: "div", children: [] },
      { renderCheck, validate: async () => [] },
    );
    const res = await registry.execute("set_property", { key: "id", path: [], value: "x" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("broke rendering");
    expect(res.error).toContain("render boom");
  });

  test("a hardcoded design-token value yields a soft hint but still succeeds", async () => {
    const { registry } = harness(
      { tagName: "div", children: [] },
      { projectStyle: { "--color-accent": "#ff0000" }, validate: async () => [] },
    );
    const res = await registry.execute("set_style", {
      path: [],
      property: "color",
      value: "#ff0000",
    });
    expect(res.success).toBe(true);
    expect(res.summary).toContain("--color-accent");
  });
});

describe("tools — file creation", () => {
  test("create_component writes the file when storage is available", async () => {
    const saved: [string, string][] = [];
    const { registry } = harness(
      { tagName: "div", children: [] },
      { saveFile: async (p, c) => void saved.push([p, c]), validate: async () => [] },
    );
    const res = await registry.execute("create_component", {
      content: { children: [], tagName: "my-card" },
      path: "components/card.json",
    });
    expect(res.success).toBe(true);
    expect(res.summary).toContain("Created component");
    expect(saved[0]![0]).toBe("components/card.json");
  });

  test("create_component surfaces a render failure and a write failure", async () => {
    const { registry: r1 } = harness(
      { tagName: "div", children: [] },
      {
        renderCheck: async () => ({ error: "no render", ok: false }),
        saveFile: async () => {},
        validate: async () => [],
      },
    );
    expect(
      await execErr(r1, "create_component", { content: { tagName: "x" }, path: "c.json" }),
    ).toContain("fails to render");

    const { registry: r2 } = harness(
      { tagName: "div", children: [] },
      {
        saveFile: async () => {
          throw new Error("disk full");
        },
        validate: async () => [],
      },
    );
    expect(
      await execErr(r2, "create_component", { content: { tagName: "x" }, path: "c.json" }),
    ).toContain("Failed to write file");
  });

  test("create_page writes the file, and reports when storage is unavailable", async () => {
    const saved: [string, string][] = [];
    const { registry } = harness(
      { tagName: "div", children: [] },
      { saveFile: async (p, c) => void saved.push([p, c]), validate: async () => [] },
    );
    const ok = await registry.execute("create_page", {
      content: { children: [], tagName: "div" },
      path: "pages/about.json",
    });
    expect(ok.success).toBe(true);
    expect(saved[0]![0]).toBe("pages/about.json");

    const { registry: r2 } = harness({ tagName: "div", children: [] }); // No saveFile
    expect(
      await execErr(r2, "create_page", { content: { tagName: "div" }, path: "p.json" }),
    ).toContain("not available");
    expect(
      await execErr(r2, "create_component", { content: { tagName: "x" }, path: "c.json" }),
    ).toContain("not available");
  });

  test("create_page surfaces schema errors and a render failure before writing", async () => {
    const { registry: r1 } = harness(
      { tagName: "div", children: [] },
      { saveFile: async () => {}, validate: async () => ["/tagName: must match pattern"] },
    );
    expect(
      await execErr(r1, "create_page", { content: { tagName: "bad page" }, path: "p.json" }),
    ).toContain("schema errors");

    const { registry: r2 } = harness(
      { tagName: "div", children: [] },
      {
        renderCheck: async () => ({ error: "no render", ok: false }),
        saveFile: async () => {},
        validate: async () => [],
      },
    );
    expect(
      await execErr(r2, "create_page", { content: { tagName: "x" }, path: "p.json" }),
    ).toContain("fails to render");

    const { registry: r3 } = harness(
      { tagName: "div", children: [] },
      {
        saveFile: async () => {
          throw new Error("disk full");
        },
        validate: async () => [],
      },
    );
    expect(
      await execErr(r3, "create_page", { content: { tagName: "x" }, path: "p.json" }),
    ).toContain("Failed to write file");
  });
});

describe("tools — perception (§12.4)", () => {
  const doc: JxMutableNode = {
    tagName: "div",
    children: [{ tagName: "button", textContent: "Save" }],
  };

  test("get_selection/describe_canvas/measure_nodes degrade when perception is absent", async () => {
    const { registry } = harness(doc);
    expect(await execErr(registry, "get_selection", {})).toContain("not available");
    expect(await execErr(registry, "describe_canvas", {})).toContain("not available");
    expect(await execErr(registry, "measure_nodes", { paths: [["children", 0]] })).toContain(
      "not available",
    );
  });

  test("get_selection returns null when nothing is selected", async () => {
    const { registry } = harness(doc, { perception: { selection: null } });
    const result = await registry.execute("get_selection", {});
    expect(result).toEqual({
      success: true,
      data: null,
      summary: "Nothing is currently selected.",
    });
  });

  test("get_selection resolves the selected path to its tagName", async () => {
    const { registry } = harness(doc, { perception: { selection: ["children", 0] } });
    const result = await registry.execute("get_selection", {});
    expect(result).toEqual({
      success: true,
      data: { path: ["children", 0], tagName: "button" },
    });
  });

  test("describe_canvas returns the mock rendered tree, optionally scoped to root", async () => {
    const nodes = [
      {
        path: ["children", 0],
        tagName: "button",
        rect: { height: 10, width: 20, x: 0, y: 0 },
        childCount: 0,
      },
    ];
    const { registry } = harness(doc, { perception: { renderedTree: nodes } });
    const result = await registry.execute("describe_canvas", {});
    expect(result).toEqual({ success: true, data: nodes });

    const { registry: r2 } = harness(doc, { perception: { renderedTree: nodes } });
    const scoped = await r2.execute("describe_canvas", { root: ["children", 0] });
    expect(scoped.success).toBe(true);
  });

  test("measure_nodes returns rects only for paths the mock resolves", async () => {
    const rect = { height: 10, width: 20, x: 5, y: 5 };
    const { registry } = harness(doc, {
      perception: { measure: [{ path: ["children", 0], rect }] },
    });
    const result = await registry.execute("measure_nodes", {
      paths: [["children", 0], ["missing"]],
    });
    expect(result).toEqual({ success: true, data: [{ path: ["children", 0], rect }] });
  });
});
