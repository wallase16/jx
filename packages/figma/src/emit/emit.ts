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

  files["project.json"] = JSON.stringify(projectConfig, null, 2);

  const page = rewriteImagePaths(result.document, images);
  files[`pages/${pageName}.json`] = JSON.stringify(page, null, 2);

  if (images) {
    for (const [ref, bytes] of images) {
      files[`public/images/${ref}.png`] = bytes;
    }
  }

  return files;
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
