/**
 * Emit — Build a .jx project file map in memory from a ConvertResult.
 *
 * Produces a Record<string, string | Uint8Array> where keys are relative file paths
 * and values are file contents (JSON strings for documents, raw bytes for images).
 *
 * @license MIT
 */

import type { JxDocument, JxStyle, ProjectConfig } from "@jxsuite/schema/types";
import type { ConvertResult } from "../convert/figma-to-jx.ts";

export interface EmitOptions {
  projectName?: string;
  pageName?: string;
  images?: Map<string, Uint8Array>;
}

export type FileMap = Record<string, string | Uint8Array>;

export function emitProject(result: ConvertResult, options?: EmitOptions): FileMap {
  const files: FileMap = {};
  const name = options?.projectName ?? "Figma Import";
  const pageName = options?.pageName ?? "index";
  const images = options?.images;

  const projectConfig: ProjectConfig = {
    name,
    defaults: {
      lang: "en",
    },
  };

  if (result.tokens && Object.keys(result.tokens).length > 0) {
    const style: JxStyle = {};
    for (const varName of Object.keys(result.tokens)) {
      const cssVar = varName.startsWith("--") ? varName : `--${varName}`;
      style[cssVar] = result.tokens[varName] || "inherit";
    }
    projectConfig.style = style;
  }

  if (result.components && Object.keys(result.components).length > 0) {
    const components: Record<string, { src: string }> = {};
    for (const [compName, compDoc] of Object.entries(result.components)) {
      const filename = `components/${compName}.json`;
      components[compName] = { src: `./${filename}` };
      files[filename] = JSON.stringify(compDoc, null, 2);
    }
    projectConfig.components = components;
  }

  files["project.json"] = JSON.stringify(projectConfig, null, 2);

  const pageDoc = extractComponentRefs(result.document, result.components);
  const page = rewriteImagePaths(pageDoc, images);
  files[`pages/${pageName}.json`] = JSON.stringify(page, null, 2);

  if (images) {
    for (const [ref, bytes] of images) {
      files[`public/images/${ref}.png`] = bytes;
    }
  }

  return files;
}

function extractComponentRefs(
  doc: JxDocument,
  components?: Record<string, JxDocument>,
): JxDocument {
  if (!components || Object.keys(components).length === 0) {
    return doc;
  }
  const raw = structuredClone(doc) as unknown as Record<string, unknown>;
  walkAndReplace(raw, components);

  if (raw.state && typeof raw.state === "object") {
    const state = raw.state as Record<string, unknown>;
    for (const key of Object.keys(state)) {
      if (key.endsWith("_variant")) {
        delete state[key];
      }
    }
    if (Object.keys(state).length === 0) {
      delete raw.state;
    }
  }

  return raw as unknown as JxDocument;
}

function walkAndReplace(
  node: Record<string, unknown>,
  components: Record<string, JxDocument>,
): void {
  if (!Array.isArray(node.children)) {
    return;
  }
  const children = node.children as Record<string, unknown>[];
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child && typeof child === "object" && "__component" in child) {
      const compName = child.__component as string;
      if (components[compName]) {
        const ref: Record<string, unknown> = {
          $ref: `./components/${compName}.json`,
        };
        if (child.__componentProps) {
          ref.$props = child.__componentProps;
        }
        children[i] = ref;
        continue;
      }
    }
    if (child && typeof child === "object") {
      walkAndReplace(child as Record<string, unknown>, components);
    }
  }
}

function rewriteImagePaths(doc: JxDocument, images?: Map<string, Uint8Array>): JxDocument {
  if (!images || images.size === 0) {
    return doc;
  }
  return JSON.parse(JSON.stringify(doc), (_key, value) => {
    if (typeof value === "string") {
      const imgMatch = value.match(/^images\/([^.]+)\.png$/);
      if (imgMatch && images.has(imgMatch[1])) {
        return `/images/${imgMatch[1]}.png`;
      }
      const urlMatch = value.match(/^url\(images\/([^)]+)\.png\)$/);
      if (urlMatch && images.has(urlMatch[1])) {
        return `url(/images/${urlMatch[1]}.png)`;
      }
    }
    return value;
  }) as JxDocument;
}
