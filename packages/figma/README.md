# @jxsuite/figma

Figma → Jx converter and plugin. Turns Figma frames into live, reactive Jx documents — the
"trojan horse" that lets Figma users experience Jx without leaving Figma.

> **Status: de-risk spike.** The conversion core and the in-Figma live-preview hook are proven
> end-to-end (see _Spike findings_). Fidelity is intentionally medium; download/eject, component
> mapping, and variant→state are not built yet.

## What's here

| Path                         | Role                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| `src/convert/figma-to-jx.ts` | Pure Figma-node-tree → `JxDocument` mapping (auto-layout→flex, fills, type) |
| `src/convert/serialize.ts`   | Flatten a live Figma `SceneNode` into the converter's plain input shape     |
| `plugin/code.ts`             | Sandbox entry — serializes the current selection, posts it to the UI        |
| `plugin/ui.ts` + `ui.html`   | Iframe — converts + mounts with the **real Jx runtime** (live preview)      |
| `plugin/build.ts`            | Bundles both; inlines the runtime into a self-contained `ui.html`           |

## Try it in Figma

```sh
bun run --cwd packages/figma build:plugin   # writes plugin/dist/{code.js,ui.html}
```

Then in Figma desktop: **Plugins → Development → Import plugin from manifest…** and pick
`packages/figma/plugin/manifest.json`. Select a frame; the plugin panel renders it live.

## Spike findings (de-risk gate — passed)

1. **The runtime mounts a converted tree with no server.** `figmaToJx` output drives
   `@jxsuite/runtime`'s `buildScope → renderNode` directly (`tests/render-proof.test.ts`),
   the same conditions as the plugin iframe.
2. **The runtime bundles into a self-contained iframe doc** (~46 KB `ui.html`, only
   `@vue/reactivity` pulled in). No network needed — satisfies Figma's sandbox.
3. **Gotcha — style keys must be camelCase.** The runtime applies scalar styles via
   `el.style[prop] = value` ([runtime.ts](../runtime/src/runtime.ts) `applyStyle`), so kebab keys
   (`flex-direction`) silently no-op. The converter emits `flexDirection`, `borderRadius`, etc.

## Out of scope for the spike (next milestones)

- Download/eject to a `.jx` project (reuse the lean emit core from `packages/import`)
- `COMPONENT`/`INSTANCE` → Jx component mapping; variants/variables → reactive state
- Fidelity: constraints, absolute positioning, effects/shadows, gradients, image fills
