// SPDX-License-Identifier: MIT
/** The file boundary, kept thin: everything above it works on strings. */
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { SourceFile } from "./agenda.js";
import { RefusedError } from "./model.js";

const SKIPPED_FOLDERS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

/** Writes a file atomically, and refuses if it changed since `original` was read. */
export const writeIfUnchanged = (path: string, original: string, text: string): void => {
  if (readFileSync(path, "utf8") !== original) throw new RefusedError(`${path} changed while it was being edited`);
  const real = realpathSync(path);
  replaceFile(real, text, statSync(real).mode);
};

const replaceFile = (path: string, text: string, mode: number): void => {
  const temporary = join(dirname(path), `.${randomBytes(6).toString("hex")}.orgdown`);
  writeFileSync(temporary, text, { mode, flag: "wx" });
  renameSync(temporary, path);
};

/** Adds text to an archive file, creating it if needed. A symlink is refused, so a write stays where it's aimed. */
export const appendToArchive = (target: string, source: string, text: string): void => {
  if (!existsSync(target)) {
    replaceFile(target, text, 0o644);
    return;
  }
  if (lstatSync(target).isSymbolicLink()) throw new RefusedError(`${target} is a symbolic link`);
  if (realpathSync(target) === realpathSync(source)) throw new RefusedError("a file can't be its own archive");
  const existing = readFileSync(target, "utf8");
  // Appending, not rewriting, so two archive runs can't discard each other's tasks.
  appendFileSync(target, `${existing === "" || existing.endsWith("\n") ? "" : "\n"}${text}`);
};

const walk = (root: string, folder: string, found: SourceFile[]): void => {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name) && !entry.name.startsWith(".")) walk(root, path, found);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push({ path: relative(root, path).split(sep).join("/"), text: readFileSync(path, "utf8") });
    }
  }
};

/** Every Markdown file under `root`, with paths relative to it. */
export const markdownFiles = (root: string): SourceFile[] => {
  const found: SourceFile[] = [];
  walk(root, root, found);
  return found;
};
