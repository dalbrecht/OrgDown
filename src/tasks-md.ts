// SPDX-License-Identifier: MIT
/** The `TASKS.md` profile: spec/profiles/tasks-md.md. */
import { isDate } from "./dates.js";
import { RefusedError, isClosed, type Doc, type Line, type Profile, type State, type Task } from "./model.js";
import { complete, canonicalTokens, insertLine, refuseBadTokens, reopen, subtreeEnd, trash } from "./operations.js";
import { TASK, indentColumns, opensToken, parseCore, readProgress, readTags, stripCarriageReturn } from "./parse.js";

interface SectionRule {
  state: State;
  allowed: readonly State[];
}

export const SECTION_RULES: Record<string, SectionRule> = {
  active: { state: "next", allowed: ["inbox", "next", "in-progress", "blocked"] },
  "waiting on": { state: "waiting", allowed: ["waiting"] },
  someday: { state: "someday", allowed: ["someday"] },
  done: { state: "done", allowed: ["done", "trash"] },
};

const SECTION_ORDER = ["Active", "Waiting On", "Someday", "Done"];
const BOLD = /^\*\*(.+?)\*\*(.*)$/;
const STRUCK = /^~~(.+?)~~(?:\s*\((\d{4}-\d{2}-\d{2})\))?$/;
const HEADING = /^## \*{0,2}(.+?)\*{0,2}\s*$/;

/** Picks the profile a file's name asks for. */
export const profileFor = (path: string): Profile => {
  const name = path.split("/").at(-1);
  if (name === "TASKS.md") return "tasks-md";
  if (name === "tasks.v2.md") return "tasks-v2";
  return "core";
};

/** The heading text of a `##` line, or null if it isn't one. */
export const headingOf = (text: string): string | null => HEADING.exec(stripCarriageReturn(text))?.[1]?.trim() ?? null;

interface TitleParts {
  inner: string;
  note: string;
  isBold: boolean;
  isStruck: boolean;
  date: string | null;
}

/** Splits a core title into the profile's parts. The rules follow the dashboard's own parser. */
export const titleParts = (title: string): TitleParts => {
  const bold = BOLD.exec(title);
  const text = bold === null ? title : (bold[1] as string);
  const note = bold === null ? "" : (bold[2] as string).replace(/^\s*-\s*/, "").trim();
  const struck = STRUCK.exec(text);
  const date = struck?.[2] ?? null;
  return {
    inner: struck === null ? text : (struck[1] as string),
    note,
    isBold: bold !== null,
    isStruck: struck !== null,
    date: date !== null && isDate(date) ? date : null,
  };
};

/** A task's `@status:`, unless Core reads it away: waiting needs a reason, which `Waiting On` supplies. */
export const explicitStatus = (task: Task, rule: SectionRule): State | undefined => {
  const value = task.tokens.filter((token) => token.key === "@status:" && token.isUsed).at(-1)?.value as
    | State
    | undefined;
  return value === "waiting" && task.waitingReason === null && rule.state !== "waiting" ? undefined : value;
};

const applyProfile = (task: Task, section: string | null): void => {
  task.section = section;
  const parts = titleParts(task.rawTitle);
  task.title = parts.inner;
  task.note = parts.note;
  task.tags = [...new Set([...readTags(parts.inner), ...readTags(parts.note)])];
  if (parts.date !== null && task.completed === null) task.completed = parts.date;
  const rule = section === null ? undefined : SECTION_RULES[section.toLowerCase()];
  if (rule === undefined) return;
  const explicit = explicitStatus(task, rule);
  task.extraTokens = task.extraTokens.filter(
    (token, i, all) => !(token === "@status:waiting" && i === all.length - 1 && rule.state === "waiting"),
  );
  if (task.depth > 0) task.state = explicit ?? (task.checked ? "done" : rule.state === "done" ? "next" : rule.state);
  else if (task.checked) task.state = explicit === "trash" && rule.allowed.includes("trash") ? "trash" : "done";
  else task.state = explicit !== undefined && rule.allowed.includes(explicit) ? explicit : rule.state;
  if (task.state === "waiting")
    task.waitingReason = task.waitingReason ?? (task.note !== "" ? task.note : "unspecified");
};

/** Parses a `TASKS.md` file. */
export const parseTasksMd = (text: string, path = "TASKS.md"): Doc => {
  const doc = parseCore(text, path, "tasks-md");
  let section: string | null = null;
  for (const line of doc.lines) {
    if (line.kind === "section") section = headingOf(line.text) ?? section;
    if (line.task !== undefined) applyProfile(line.task, section);
  }
  readProgress(doc.tasks);
  return doc;
};

/** Parses a file with the profile its name asks for. */
export const parseAuto = (text: string, path: string): Doc =>
  profileFor(path) === "tasks-md" ? parseTasksMd(text, path) : parseCore(text, path, profileFor(path));

const tokensText = (task: Task): string => task.tokens.map((token) => token.text).join(" ");

const render = (checkChar: string, inner: string, note: string, tokens: string, trailer = ""): string => {
  const tail = [note, tokens].filter((part) => part !== "").join(" ");
  return `- [${checkChar}] **${inner}**${tail === "" ? "" : ` - ${tail}`}${trailer}`;
};

const rawInner = (rawTitle: string): string => {
  const bold = BOLD.exec(rawTitle);
  return (bold === null ? rawTitle : (bold[1] as string)).replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, "");
};

/** Rewrites one top-level task in the profile's line form. */
const fixedLine = (task: Task, extraNote: readonly string[], line: string): string => {
  if (task.rawTitle === "") {
    const trailer = stripCarriageReturn(line).slice(task.contentEnd);
    const tail = [tokensText(task), trailer.trim()].filter((part) => part !== "").join(" ");
    return `- [${task.checked ? "x" : " "}] ${tail}`;
  }
  const parts = titleParts(task.rawTitle);
  const note = [parts.note, ...extraNote].filter((part) => part !== "").join("; ");
  const hasCompleted = task.tokens.some((token) => token.key === "completed:");
  const completed = parts.date !== null && !hasCompleted ? `completed:${parts.date}` : "";
  const tokens = [tokensText(task), completed].filter((part) => part !== "").join(" ");
  const trailer = stripCarriageReturn(line).slice(task.contentEnd).trim();
  return render(task.checked ? "x" : " ", rawInner(task.rawTitle), note, tokens, trailer === "" ? "" : ` ${trailer}`);
};

const normalizedTask = (line: string): string =>
  line.replace(TASK, (_all, indent, _marker, _gap, box, rest) => `${indent}- [${box === "X" ? "x" : box}] ${rest}`);

/** A non-task list item indented exactly one level. */
const isNoteBullet = (line: string): boolean =>
  Math.floor(indentColumns(line) / 2) === 1 && line.trimStart().startsWith("- ");

/** Upgrades a file to the profile's form: spec/profiles/tasks-md.md §6. */
export const fix = (text: string): string => {
  const doc = parseCore(text, "TASKS.md");
  const output: string[] = [];
  doc.lines.forEach((line, i) => {
    const task = line.task;
    if (task === undefined) {
      const owner = [...doc.tasks].reverse().find((other) => other.line <= i && i < other.bodyEnd);
      if (owner?.depth !== 0 || owner.rawTitle === "" || !isNoteBullet(line.text)) output.push(line.text);
      return;
    }
    if (task.depth > 0) {
      output.push(normalizedTask(line.text));
      return;
    }
    const noteLines = doc.lines.slice(task.line, task.bodyEnd).map((entry) => entry.text);
    const notes = noteLines.filter(isNoteBullet).map((text) => text.trim().slice(2).trim());
    output.push(fixedLine(task, notes, line.text));
  });
  return output.join("\n");
};

const lastNonBlank = (lines: readonly string[], from: number, to: number): number => {
  let at = to;
  while (at > from && (lines[at - 1] as string).trim() === "") at -= 1;
  return at;
};

/** The line range of a `##` section's content, or null if the file doesn't have it. */
const sectionRange = (lines: readonly string[], name: string): [number, number] | null => {
  const parsed = parseCore(lines.join("\n")).lines;
  const isHeading = (index: number): boolean =>
    parsed[index]?.kind === "section" && /^## /.test(lines[index] as string);
  const start = lines.findIndex((line, i) => isHeading(i) && headingOf(line)?.toLowerCase() === name);
  if (start === -1) return null;
  const next = lines.findIndex((_, i) => i > start && isHeading(i));
  return [start + 1, next === -1 ? lines.length : next];
};

/** Moves a block of lines to the end of a section. Without that section it stays where it is. */
const moveToSection = (lines: string[], from: number, count: number, name: string): string[] => {
  const moved = lines.slice(from, from + count);
  const without = [...lines.slice(0, from), ...lines.slice(from + count)];
  const range = sectionRange(without, name);
  if (range === null) return lines;
  without.splice(lastNonBlank(without, range[0], range[1]), 0, ...moved);
  return without;
};

/** Puts ` - ` before tokens on a bold title, and removes a ` -` with nothing after it. */
const tidyLine = (line: string): string => {
  const single = line.replace(/^(\s*-\s+\[.\])\s+(?=\S)/, "$1 ");
  const separated = single.replace(/^(\s*-\s+\[.\]\s+\*\*.+?\*\*)\s+(@?[a-z][a-z-]*:.*)$/i, "$1 - $2");
  return separated.replace(/(\*\*)\s+-\s*$/, "$1");
};

const strike = (line: string): string => line.replace(/^(\s*-\s+\[.\]\s+\*\*)(?!~~)(.+?)(\*\*.*)$/, "$1~~$2~~$3");
const unstrike = (line: string): string => line.replace(/^(\s*-\s+\[.\]\s+\*\*)~~(.+?)~~(\*\*.*)$/, "$1$2$3");

type CloseOperation = (doc: Doc, line: number, today: string) => string;

const close = (text: string, line: number, today: string, operation: CloseOperation): string => {
  const fixedLines = text.split("\n");
  const before = parseCore(text, "TASKS.md").lines[line - 1]?.task;
  if (before?.depth === 0) fixedLines[line - 1] = fixedLine(before, [], fixedLines[line - 1] as string);
  const doc = parseCore(fixedLines.join("\n"), "TASKS.md");
  const task = doc.lines[line - 1]?.task;
  const count = task === undefined ? 0 : subtreeEnd(doc, task) - task.line + 1;
  const lines = operation(doc, line, today).split("\n");
  lines[line - 1] = strike(tidyLine(lines[line - 1] as string));
  if (lines[line - 1 + count] !== undefined) lines[line - 1 + count] = tidyLine(lines[line - 1 + count] as string);
  return (task?.depth === 0 ? moveToSection(lines, line - 1, count, "done") : lines).join("\n");
};

/** Completes a task and moves it to `Done`. A next occurrence stays where the task was. */
export const completeTasksMd = (text: string, line: number, today: string): string =>
  close(text, line, today, complete);

/** Trashes a task and moves it to `Done`. */
export const trashTasksMd = (text: string, line: number, today: string): string => close(text, line, today, trash);

/** Reopens a task and moves it to `Active`. */
export const reopenTasksMd = (text: string, line: number): string => {
  const doc = parseCore(text, "TASKS.md");
  const task = doc.lines[line - 1]?.task;
  const count = task === undefined ? 0 : subtreeEnd(doc, task) - task.line + 1;
  const lines = reopen(doc, line).split("\n");
  lines[line - 1] = tidyLine(unstrike(lines[line - 1] as string));
  return (task?.depth === 0 ? moveToSection(lines, line - 1, count, "active") : lines).join("\n");
};

/** Adds a task in the profile's line form, by default to `Active`, adding that section if needed. */
export const addTasksMd = (
  text: string,
  title: string,
  tokens: readonly string[],
  section = "Active",
  note = "",
): string => {
  if (title.includes("\n") || note.includes("\n")) throw new RefusedError("a title cannot contain a newline");
  refuseBadTokens(tokens);
  const lastWord = note.trim().split(/\s+/).at(-1) ?? "";
  if (tokens.length === 0 && opensToken(lastWord)) {
    throw new RefusedError(`the note ends in "${lastWord}", which would be read as a token`);
  }
  const row = render(" ", title, note, canonicalTokens(tokens).join(" "));
  const doc = parseCore(text, "TASKS.md");
  if (doc.lines.some((line) => line.kind === "section" && headingOf(line.text) === section)) {
    return insertLine(doc, row, section);
  }
  return `${text.trimEnd()}${text.trim() === "" ? "" : "\n\n"}## ${section}\n${row}\n`;
};

/** Core tokens for a task, without its `@status:`, in canonical order. */
const carriedTokens = (task: Task): string[] =>
  task.tokens.filter((token) => token.key !== "@status:").map((token) => token.text);

/** Converts a `TASKS.md` file to a Core file: spec/profiles/tasks-md.md §7. */
export const toCore = (text: string): string => {
  const doc = parseTasksMd(text);
  return doc.lines
    .map((line: Line) => {
      const task = line.task;
      if (task === undefined) return line.text;
      const tokens = carriedTokens(task).filter((token) => !token.startsWith("@waiting:"));
      if (task.completed !== null && !tokens.some((token) => token.startsWith("completed:")))
        tokens.push(`completed:${task.completed}`);
      const isDefault = task.state === (isClosed(task.state) ? "done" : "inbox");
      if (!isDefault) tokens.push(`@status:${task.state}`);
      if (task.waitingReason !== null) tokens.push(`@waiting:"${task.waitingReason}"`);
      const title = task.note === "" ? task.title : `${task.title} - ${task.note}`;
      return [`${task.indent}- [${isClosed(task.state) ? "x" : " "}] ${title}`, ...canonicalTokens(tokens)].join(" ");
    })
    .join("\n");
};

const sectionFor = (state: State): string => {
  if (state === "waiting") return "Waiting On";
  if (state === "someday") return "Someday";
  return isClosed(state) ? "Done" : "Active";
};

const rootStatus = (state: State): string[] => {
  const isImplied = state === "next" || state === "waiting" || state === "someday" || state === "done";
  return isImplied ? [] : [`@status:${state}`];
};

const subLine = (task: Task): string => {
  const status = ["inbox", "next", "done"].includes(task.state) ? [] : [`@status:${task.state}`];
  const tokens = canonicalTokens([...carriedTokens(task), ...status]);
  return [`  - [${isClosed(task.state) ? "x" : " "}] ${task.rawTitle}`, ...tokens].join(" ");
};

export interface Conversion {
  text: string;
  warnings: string[];
}

/** Converts a Core file to a `TASKS.md` file: spec/profiles/tasks-md.md §7. */
export const fromCore = (text: string): Conversion => {
  const doc = parseCore(text, "tasks.md");
  const warnings: string[] = [];
  const sections = new Map<string, string[]>(SECTION_ORDER.map((name) => [name, []]));
  const bodyLines = new Set(doc.tasks.flatMap((task) => task.body.map((_, i) => task.line + i)));
  let root: Task | null = null;
  let warnedRoot: Task | null = null;
  for (const task of doc.tasks) {
    if (task.body.length > 0) warnings.push(`line ${task.line}: the notes under "${task.title}" were dropped`);
    if (task.parent === null) {
      root = task;
      const tokens = canonicalTokens([...carriedTokens(task), ...rootStatus(task.state)]).join(" ");
      const inner = isClosed(task.state) ? `~~${task.title}~~` : task.title;
      sections.get(sectionFor(task.state))?.push(render(isClosed(task.state) ? "x" : " ", inner, "", tokens));
      continue;
    }
    if (task.depth > 1 && warnedRoot !== root) {
      warnedRoot = root;
      warnings.push(`line ${task.line}: subtasks under "${root?.title}" were flattened to one level`);
    }
    sections.get(sectionFor((root as Task).state))?.push(subLine(task));
  }
  doc.lines.forEach((line, i) => {
    const isTemplate = line.text === "# Tasks" || SECTION_ORDER.includes(headingOf(line.text) ?? "");
    if (line.kind !== "task" && line.text.trim() !== "" && !bodyLines.has(i) && !isTemplate)
      warnings.push(`line ${i + 1}: "${line.text.trim()}" was dropped`);
  });
  const body = SECTION_ORDER.map((name) => {
    const rows = sections.get(name) as string[];
    return rows.length === 0 ? `## ${name}` : `## ${name}\n\n${rows.join("\n")}`;
  });
  return { text: `# Tasks\n\n${body.join("\n\n")}\n`, warnings };
};
