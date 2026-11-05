// SPDX-License-Identifier: MIT
/** Preserving edits: spec/04-operations.md and the logbook writes in spec/05-logbook.md. */
import { addDays, isDate, toDays, toMinutes } from "./dates.js";
import { RefusedError, isClosed, type Doc, type Task, type Token } from "./model.js";
import { RULE_KEYS, opensToken, parseCore, stripCarriageReturn } from "./parse.js";
import { nextOccurrence } from "./recurrence.js";

const CANONICAL_ORDER = [
  "@status:",
  "@context:",
  "@energy:",
  "@waiting:",
  "due:",
  "defer:",
  "@due-time:",
  "@warn:",
  "at:",
  "@remind:",
  "@estimate:",
  "@priority:",
  "@today:",
  "@every:",
  "@after:",
  "@repeat-on:",
  "@repeat-until:",
  "@repeat-count:",
  "@repeat-catch-up:",
  "@habit:",
  "completed:",
];

const keyOf = (token: string): string => token.slice(0, token.indexOf(":") + 1);

/** Sorts tokens into canonical order: spec/01-core.md §7. Unknown keys go before `@kind:`. */
export const canonicalTokens = (tokens: readonly string[]): string[] => {
  const rank = (token: string): number => {
    const key = keyOf(token);
    if (key === "@kind:") return CANONICAL_ORDER.length + 1;
    const index = CANONICAL_ORDER.indexOf(key);
    return index === -1 ? CANONICAL_ORDER.length : index;
  };
  return tokens
    .map((token, i) => ({ token, i }))
    .sort((a, b) => rank(a.token) - rank(b.token) || a.i - b.i)
    .map(({ token }) => token);
};

/** An edit to one raw line, applied to a fresh copy so positions stay valid. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

const applyEdits = (raw: string, edits: readonly Edit[]): string =>
  [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((line, { start, end, text }) => line.slice(0, start) + text + line.slice(end), raw);

/** The token that sets a field: the last valid one of its key. */
const lastUsed = (task: Task, key: string): Token | undefined =>
  task.tokens.filter((token) => token.key === key && token.isUsed).at(-1);

const removal = (raw: string, token: Token): Edit => {
  const before = raw[token.start - 1];
  return { start: before === " " || before === "\t" ? token.start - 1 : token.start, end: token.end, text: "" };
};

/** Builds the edits for setting a token, and adds it to the run if the task hasn't got one. */
const setOrAppend = (task: Task, key: string, value: string, appended: string[]): Edit[] => {
  const token = lastUsed(task, key);
  if (token !== undefined) return [{ start: token.start, end: token.end, text: key + value }];
  appended.push(key + value);
  return [];
};

const taskAt = (doc: Doc, line: number): Task => {
  const task = doc.lines[line - 1]?.task;
  if (task === undefined) throw new RefusedError(`line ${line} is not a task`);
  return task;
};

/** Adds tokens at the end of the run. A trailer right after an empty title gets its own space. */
const appendEdit = (raw: string, task: Task, appended: readonly string[]): Edit[] => {
  if (appended.length === 0) return [];
  const isTrailerNext = raw.slice(task.contentEnd).startsWith("<!--");
  const text = appended.map((token) => ` ${token}`).join("") + (isTrailerNext ? " " : "");
  return [{ start: task.contentEnd, end: task.contentEnd, text }];
};

const boxEdit = (raw: string, task: Task, char: string): Edit => {
  const open = raw.indexOf("[", task.indent.length + task.marker.length);
  return { start: open + 1, end: open + 2, text: char };
};

/** Replaces `\r`-free line text, keeping the line's own ending. */
const lineWithEnding = (raw: string, newText: string): string =>
  raw.endsWith("\r") && !newText.endsWith("\r") ? `${newText}\r` : newText;

/** The 0-based index after the last line of a task's subtree, bodies included. */
export const subtreeEnd = (doc: Doc, task: Task): number => {
  let end = task.bodyEnd;
  for (const other of doc.tasks) {
    if (other.index <= task.index) continue;
    if (other.depth <= task.depth) break;
    const between = doc.lines.slice(task.line, other.line - 1);
    if (between.some((line) => line.kind === "section")) break;
    end = other.bodyEnd;
  }
  return end;
};

/** Moves `value`, which may be a day, a datetime or a range, by whole days. */
const shiftStamp = (value: string, days: number): string =>
  value
    .split("/")
    .map((part) =>
      part.length >= 10 && isDate(part.slice(0, 10)) ? addDays(part.slice(0, 10), days) + part.slice(10) : part,
    )
    .join("/");

/** Whether a series continues, and if so where. */
const nextDue = (task: Task, completed: string | null, today: string): string | null => {
  const rule = task.recurrence;
  if (rule === null || rule.count === 0) return null;
  return nextOccurrence(rule, task.due ?? today, completed, today);
};

/** Edits that move the current occurrence's dates to `next`, in the task's own line. */
const occurrenceEdits = (task: Task, next: string, appended: string[]): Edit[] => {
  const edits = setOrAppend(task, "due:", next, appended);
  const delta = task.due === null ? null : toDays(next) - toDays(task.due);
  for (const key of ["defer:", "at:", "@remind:"]) {
    const token = lastUsed(task, key);
    if (token === undefined) continue;
    if (delta === null) continue;
    edits.push({ start: token.start, end: token.end, text: key + shiftStamp(token.value, delta) });
  }
  const count = lastUsed(task, "@repeat-count:");
  if (count !== undefined)
    edits.push({ start: count.start, end: count.end, text: `@repeat-count:${Number(count.value) - 1}` });
  return edits;
};

/** Renders the line for the next occurrence of a repeating task. */
const nextOccurrenceLine = (raw: string, task: Task, next: string): string => {
  const appended: string[] = [];
  const edits = occurrenceEdits(task, next, appended);
  const edited = new Set(edits.map((edit) => edit.start));
  for (const token of task.tokens) {
    if (!token.isUsed) continue;
    if (["@priority:", "@today:", "@waiting:", "completed:"].includes(token.key)) edits.push(removal(raw, token));
    if (task.due === null && ["defer:", "at:", "@remind:"].includes(token.key) && !edited.has(token.start))
      edits.push(removal(raw, token));
  }
  const status = lastUsed(task, "@status:");
  if (task.state === "inbox") {
    for (const token of task.tokens) if (token.key === "@status:" && token.isUsed) edits.push(removal(raw, token));
  }
  if (status !== undefined && task.state !== "inbox")
    edits.push({ start: status.start, end: status.end, text: "@status:next" });
  if (status === undefined && task.state !== "inbox") appended.push("@status:next");
  edits.push(boxEdit(raw, task, " "));
  edits.push(...appendEdit(raw, task, appended));
  // The trailer belongs to the finished line: only the owning application mints identity.
  return lineWithEnding(raw, applyEdits(raw.slice(0, task.contentEnd), edits).trimEnd());
};

/** Completes a task, and creates its next occurrence if it repeats. */
export const complete = (doc: Doc, line: number, today: string): string => {
  const task = taskAt(doc, line);
  const raw = doc.lines[line - 1]?.text as string;
  const next = nextDue(task, today, today);
  const appended: string[] = [];
  const status = lastUsed(task, "@status:");
  const edits: Edit[] = [];
  if (!task.checked) edits.push(boxEdit(raw, task, "x"));
  if (status !== undefined) edits.push({ start: status.start, end: status.end, text: "@status:done" });
  edits.push(...setOrAppend(task, "completed:", today, appended));
  for (const token of task.tokens) {
    const isDropped = token.key === "@priority:" || token.key === "@waiting:";
    const isRule = RULE_KEYS.includes(token.key) && token.isUsed;
    if ((isDropped && token.isUsed) || isRule) edits.push(removal(raw, token));
  }
  edits.push(...appendEdit(raw, task, appended));
  const lines = doc.lines.map((entry) => entry.text);
  lines[line - 1] = applyEdits(raw, edits);
  if (next !== null) lines.splice(subtreeEnd(doc, task), 0, nextOccurrenceLine(raw, task, next));
  return lines.join("\n");
};

/** Abandons a task. Its rule stays on the line, and no next occurrence is created. */
export const trash = (doc: Doc, line: number, today: string): string => {
  const task = taskAt(doc, line);
  const raw = doc.lines[line - 1]?.text as string;
  const appended: string[] = [];
  const edits: Edit[] = [
    ...setOrAppend(task, "@status:", "trash", appended),
    ...setOrAppend(task, "completed:", today, appended),
  ];
  if (!task.checked) edits.push(boxEdit(raw, task, "x"));
  for (const token of task.tokens) {
    if ((token.key === "@priority:" || token.key === "@waiting:") && token.isUsed) edits.push(removal(raw, token));
  }
  edits.push(...appendEdit(raw, task, appended));
  return replaceLine(doc, line, applyEdits(raw, edits));
};

/** A task line needs whitespace after its checkbox, or it stops being a task. */
const keepTask = (line: string): string => line.replace(/^(\s*[-*+]\s+\[[ xX]\])(?=\S|\r?$)/, "$1 ");

const replaceLine = (doc: Doc, line: number, text: string): string =>
  doc.lines.map((entry, i) => (i === line - 1 ? keepTask(text) : entry.text)).join("\n");

/** Reopens a closed task. */
export const reopen = (doc: Doc, line: number): string => {
  const task = taskAt(doc, line);
  const raw = doc.lines[line - 1]?.text as string;
  const edits: Edit[] = [boxEdit(raw, task, " ")];
  for (const token of task.tokens) {
    if (token.key === "completed:") edits.push(removal(raw, token));
    if (token.key === "@status:" && token.isUsed && isClosed(token.value as Task["state"]))
      edits.push(removal(raw, token));
  }
  return replaceLine(doc, line, applyEdits(raw, edits));
};

/** Moves a repeating task to its next occurrence without completing it. */
export const skip = (doc: Doc, line: number, today: string): string => {
  const task = taskAt(doc, line);
  if (task.recurrence === null) throw new RefusedError(`line ${line} doesn't repeat`);
  const next = nextDue(task, today, today);
  if (next === null) throw new RefusedError(`the series on line ${line} has ended`);
  const raw = doc.lines[line - 1]?.text as string;
  const appended: string[] = [];
  const edits = occurrenceEdits(task, next, appended);
  edits.push(...appendEdit(raw, task, appended));
  return replaceLine(doc, line, applyEdits(raw, edits));
};

/** Refuses a line that wouldn't read back as written: spec/04-operations.md §6. */
export const refuseMisread = (line: string, tokens: readonly string[], describe: string): void => {
  if (line.includes("\n")) throw new RefusedError("a task cannot contain a newline");
  const task = parseCore(line).tasks[0];
  const bad = task?.tokens.find((token) => !token.isUsed && !token.key.startsWith("@x-"));
  if (bad !== undefined) throw new RefusedError(`"${bad.text}" is not a valid token`);
  if (task?.extraTokens.some((token) => !token.startsWith("@x-")) === true) {
    throw new RefusedError("a token here is not valid");
  }
  if (task?.tokens.length !== tokens.length) throw new RefusedError(`${describe} would be read as tokens`);
};

/** Adds a task in canonical form. */
export const add = (doc: Doc, title: string, tokens: readonly string[], section?: string): string => {
  if (tokens.includes("@status:done") || tokens.includes("@status:trash")) {
    throw new RefusedError("a new task cannot be closed");
  }
  if (tokens.some((token) => token.startsWith("@project:"))) throw new RefusedError("@project: is read-only");
  const line = [`- [ ] ${title}`, ...canonicalTokens(tokens)].join(" ");
  refuseMisread(line, tokens, "the end of the title");
  return insertLine(doc, line, section);
};

/** Inserts a finished line into a section, or at the end of the document. */
export const insertLine = (doc: Doc, text: string, section?: string): string => {
  const texts = doc.lines.map((line) => line.text);
  if (texts.length === 1 && texts[0] === "") return text;
  const sectionText = (line: string): string =>
    stripCarriageReturn(line)
      .replace(/^#+\s+/, "")
      .trim();
  const start =
    section === undefined
      ? -1
      : doc.lines.findIndex((line) => line.kind === "section" && sectionText(line.text) === section);
  let end = texts.length;
  if (start !== -1) {
    const after = doc.lines.findIndex((line, i) => i > start && line.kind === "section");
    if (after !== -1) end = after;
  }
  let insertAt = end;
  while (insertAt > 0 && (texts[insertAt - 1] as string).trim() === "") insertAt -= 1;
  texts.splice(insertAt, 0, text);
  const result = texts.join("\n");
  if (parseCore(result).lines[insertAt]?.kind !== "task")
    throw new RefusedError("that place is inside an opaque block");
  return result;
};

/** Takes a closed top-level task and its subtree out of a document. */
export const archive = (doc: Doc, line: number): { text: string; removed: string } => {
  const task = taskAt(doc, line);
  if (!isClosed(task.state)) throw new RefusedError(`line ${line} is still open`);
  if (task.depth > 0) throw new RefusedError(`line ${line} is nested, so archive its top-level task`);
  const end = subtreeEnd(doc, task);
  const lines = doc.lines.map((entry) => entry.text);
  const removed = lines.splice(line - 1, end - line + 1).join("\n");
  return { text: lines.join("\n"), removed };
};

const clockLine = (task: Task, text: string): string => `${task.indent}  ${text}`;

/** Starts a clock on a task. */
export const clockIn = (doc: Doc, line: number, now: string): string => {
  const task = taskAt(doc, line);
  if (doc.tasks.some((other) => other.log.some((entry) => entry.type === "clock" && entry.end === null))) {
    throw new RefusedError("a clock is already running");
  }
  const texts = doc.lines.map((entry) => entry.text);
  texts.splice(line, 0, clockLine(task, `- clock:${now}/`));
  return texts.join("\n");
};

/** Stops the running clock on a task. */
export const clockOut = (doc: Doc, line: number, now: string): string => {
  const task = taskAt(doc, line);
  const offset = task.body.findIndex(
    (text) =>
      /^- clock:\S+\/$/.test(text) &&
      task.log.some((entry) => entry.type === "clock" && entry.end === null && text === `- clock:${entry.start}/`),
  );
  if (offset === -1) throw new RefusedError(`line ${line} has no running clock`);
  const start = (task.body[offset] as string).slice("- clock:".length, -1);
  if (toMinutes(now) <= toMinutes(start)) throw new RefusedError("the end of a clock must be after its start");
  const end = now.slice(0, 10) === start.slice(0, 10) ? now.slice(11) : now;
  const texts = doc.lines.map((entry) => entry.text);
  texts[line + offset] = clockLine(task, `- clock:${start}/${end}`);
  return texts.join("\n");
};
