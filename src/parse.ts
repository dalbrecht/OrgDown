// SPDX-License-Identifier: MIT
/** Core reader: spec/01-core.md, 02-planning.md, 03-recurrence.md parsing, 05-logbook.md body. */
import { isDate, isDateTime, isTime, toMinutes } from "./dates.js";
import {
  STATES,
  isClosed,
  type Appointment,
  type Doc,
  type Line,
  type LineKind,
  type LogEntry,
  type Profile,
  type Recurrence,
  type State,
  type Task,
  type Token,
  type Unit,
} from "./model.js";

const TASK = /^(\s*)([-*+])(\s+)\[([ xX])\]\s+(.*)$/;
const SECTION = /^#{2,6}\s+\S/;
const TRAILER = /\s*<!--\s*(.*?)\s*-->\s*$/;
const OPENS_TOKEN = /^@?[a-z][a-z-]*:/i;
const TAG = /^#\p{L}[\p{L}\p{N}_/-]*$/u;
const FENCE = /^\s*(`{3,}|~{3,})/;
const REGION_OPEN = /^\s*<!--\s*orgdown:view\b/;
const REGION_CLOSE = /^\s*<!--\s*\/orgdown:view\s*-->/;
const POSITIVE = /^[1-9]\d*$/;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const INTERVAL = /^([1-9]\d{0,3})([dwm])$/;
const UNITS: Record<string, Unit> = { d: "day", w: "week", m: "month" };

const stripCarriageReturn = (text: string): string => (text.endsWith("\r") ? text.slice(0, -1) : text);

/** Marks each line that Core never interprets: spec/01-core.md §1. */
const opaqueLines = (texts: readonly string[]): boolean[] => {
  const opaque = new Array<boolean>(texts.length).fill(false);
  let i = 0;
  if (texts[0] !== undefined && stripCarriageReturn(texts[0]) === "---") {
    const close = texts.findIndex((text, index) => index > 0 && stripCarriageReturn(text) === "---");
    if (close !== -1) {
      opaque.fill(true, 0, close + 1);
      i = close + 1;
    }
  }
  while (i < texts.length) {
    const text = stripCarriageReturn(texts[i] as string);
    const end = blockEnd(texts, i, text);
    if (end === null) {
      i += 1;
      continue;
    }
    opaque.fill(true, i, end + 1);
    i = end + 1;
  }
  return opaque;
};

/** The last line of the opaque block starting at `start`, or null if none starts there. */
const blockEnd = (texts: readonly string[], start: number, text: string): number | null => {
  const last = texts.length - 1;
  const findFrom = (test: (line: string) => boolean): number => {
    for (let j = start + 1; j <= last; j += 1) if (test(stripCarriageReturn(texts[j] as string))) return j;
    return last;
  };
  const fence = FENCE.exec(text);
  if (fence !== null) {
    const run = fence[1] as string;
    const closing = new RegExp(`^\\s*\\${run.charAt(0)}{${run.length},}\\s*$`);
    return findFrom((line) => closing.test(line));
  }
  if (REGION_OPEN.test(text)) return findFrom((line) => REGION_CLOSE.test(line));
  if (/^\s*<!--/.test(text) && !text.includes("-->")) return findFrom((line) => line.includes("-->"));
  return null;
};

const depthOf = (indent: string): number => {
  let columns = 0;
  for (const char of indent) columns += char === "\t" ? 2 : 1;
  return Math.floor(columns / 2);
};

/** A whitespace-separated word with its position in the raw line. */
interface Word {
  text: string;
  start: number;
  end: number;
}

const wordsIn = (text: string, offset: number): Word[] =>
  [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    start: offset + match.index,
    end: offset + match.index + match[0].length,
  }));

const isBalancedQuoted = (token: string): boolean => {
  const value = token.slice(token.indexOf(":") + 1);
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"');
};

/** Splits words into title words and the trailing token run: spec/01-core.md §3.2. */
const splitTokenRun = (words: readonly Word[]): { titleWords: Word[]; run: Token[] } => {
  const run: Token[] = [];
  let end = words.length;
  while (end > 0) {
    let start = end - 1;
    while (start > 0 && !OPENS_TOKEN.test((words[start] as Word).text)) start -= 1;
    if (!OPENS_TOKEN.test((words[start] as Word).text)) break;
    const parts = words.slice(start, end);
    const text = parts.map((word) => word.text).join(" ");
    if (parts.length > 1 && !isBalancedQuoted(text)) break;
    const colon = text.indexOf(":");
    run.unshift({
      text,
      key: text.slice(0, colon + 1),
      value: text.slice(colon + 1),
      start: (parts[0] as Word).start,
      end: (parts[parts.length - 1] as Word).end,
      isUsed: false,
    });
    end = start;
  }
  return { titleWords: words.slice(0, end), run };
};

const unquote = (value: string): string =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

const parseAppointment = (value: string): Appointment | null => {
  if (isDate(value) || isDateTime(value)) return { start: value };
  const [start, end, ...rest] = value.split("/");
  if (rest.length > 0 || start === undefined || end === undefined || !isDateTime(start)) return null;
  const fullEnd = isTime(end) ? `${start.slice(0, 10)}T${end}` : end;
  if (!isDateTime(fullEnd) || toMinutes(fullEnd) <= toMinutes(start)) return null;
  return { start, end: fullEnd };
};

const parseEstimate = (value: string): number | null => {
  const match = /^([1-9]\d*)([mh])$/.exec(value);
  if (match === null) return null;
  return Number(match[1]) * (match[2] === "h" ? 60 : 1);
};

const parseWeekdays = (value: string): number[] | null => {
  const days = value.split(",").map((name) => WEEKDAYS.indexOf(name));
  if (days.includes(-1)) return null;
  return [...new Set(days)].sort((a, b) => a - b);
};

const isCount = (value: string): boolean => value === "0" || POSITIVE.test(value);

/** Fields set by tokens. A reader assigns them in document order, so the last valid token wins. */
type Fields = Pick<
  Task,
  | "context"
  | "project"
  | "nodeKind"
  | "energy"
  | "waitingReason"
  | "due"
  | "defer"
  | "warnDays"
  | "at"
  | "remind"
  | "estimateMinutes"
  | "priority"
  | "today"
  | "completed"
  | "habit"
> & { status: State | null };

type Setter = (value: string, fields: Fields) => boolean;

const dateField =
  (name: "due" | "defer" | "today" | "completed"): Setter =>
  (value, fields) => {
    if (!isDate(value)) return false;
    fields[name] = value;
    return true;
  };

const SETTERS: Record<string, Setter> = {
  "@status:": (value, fields) => {
    if (!(STATES as readonly string[]).includes(value)) return false;
    fields.status = value as State;
    return true;
  },
  "@context:": (value, fields) => {
    fields.context = unquote(value);
    return true;
  },
  "@project:": (value, fields) => {
    fields.project = value;
    return true;
  },
  "@kind:": (value, fields) => {
    if (value !== "project" && value !== "single-action") return false;
    fields.nodeKind = value;
    return true;
  },
  "@energy:": (value, fields) => {
    if (!["low", "medium", "high"].includes(value)) return false;
    fields.energy = value;
    return true;
  },
  "@waiting:": (value, fields) => {
    const reason = unquote(value);
    if (reason.trim() === "") return false;
    fields.waitingReason = reason;
    return true;
  },
  "due:": dateField("due"),
  "defer:": dateField("defer"),
  "@today:": dateField("today"),
  "completed:": dateField("completed"),
  "@warn:": (value, fields) => {
    const match = /^(0|[1-9]\d*)d$/.exec(value);
    if (match === null) return false;
    fields.warnDays = Number(match[1]);
    return true;
  },
  "at:": (value, fields) => {
    const appointment = parseAppointment(value);
    if (appointment === null) return false;
    fields.at = appointment;
    return true;
  },
  "@remind:": (value, fields) => {
    if (!isDate(value) && !isDateTime(value)) return false;
    fields.remind = value;
    return true;
  },
  "@estimate:": (value, fields) => {
    const minutes = parseEstimate(value);
    if (minutes === null) return false;
    fields.estimateMinutes = minutes;
    return true;
  },
  "@priority:": (value, fields) => {
    if (!POSITIVE.test(value)) return false;
    fields.priority = Number(value);
    return true;
  },
  "@habit:": (value, fields) => {
    if (value !== "yes") return false;
    fields.habit = true;
    return true;
  },
};

const RULE_KEYS = ["@every:", "@after:", "@repeat-on:", "@repeat-until:", "@repeat-count:", "@repeat-catch-up:"];

/** True when a token's value is valid for its own key, with no regard to the rest of the rule. */
export const isRuleTokenValid = (token: Token): boolean => {
  if (token.key === "@every:" || token.key === "@after:") return INTERVAL.test(token.value);
  if (token.key === "@repeat-on:") return parseWeekdays(token.value) !== null;
  if (token.key === "@repeat-until:") return isDate(token.value);
  if (token.key === "@repeat-count:") return isCount(token.value);
  return token.value === "yes";
};

/** Reads the recurrence tokens as one rule: spec/03-recurrence.md §2. */
const readRule = (tokens: readonly Token[]): Recurrence | null => {
  const valid = tokens.filter((token) => RULE_KEYS.includes(token.key) && isRuleTokenValid(token));
  const primary = valid.filter((token) => token.key === "@every:" || token.key === "@after:").at(-1);
  if (primary === undefined) return null;
  primary.isUsed = true;
  const match = INTERVAL.exec(primary.value) as RegExpExecArray;
  const rule: Recurrence = {
    mode: primary.key === "@every:" ? "due" : "completion",
    every: Number(match[1]),
    unit: UNITS[match[2] as string] as Unit,
  };
  for (const token of valid) {
    if (token.key === "@every:" || token.key === "@after:") {
      token.isUsed = true;
    } else if (token.key === "@repeat-on:") {
      if (rule.unit === "week") {
        rule.weekdays = parseWeekdays(token.value) as number[];
        token.isUsed = true;
      }
    } else if (token.key === "@repeat-until:") {
      rule.until = token.value;
      token.isUsed = true;
    } else if (token.key === "@repeat-count:") {
      rule.count = Number(token.value);
      token.isUsed = true;
    } else if (rule.mode === "due") {
      rule.catchUp = true;
      token.isUsed = true;
    }
  }
  return rule;
};

const parseLogEntry = (text: string): LogEntry | null => {
  const clock = /^- clock:(\S+?)\/(\S*)$/.exec(text);
  if (clock !== null) {
    const [, start, rawEnd] = clock as unknown as [string, string, string];
    if (!isDateTime(start)) return null;
    if (rawEnd === "") return { type: "clock", start, end: null, minutes: null };
    const end = isTime(rawEnd) ? `${start.slice(0, 10)}T${rawEnd}` : rawEnd;
    if (!isDateTime(end) || toMinutes(end) <= toMinutes(start)) return null;
    return { type: "clock", start, end, minutes: toMinutes(end) - toMinutes(start) };
  }
  const state = /^- state:(\S+) from:(\S+) on:(\S+)$/.exec(text);
  if (state === null) return null;
  const [, to, from, on] = state as unknown as [string, State, State, string];
  if (!STATES.includes(to) || !STATES.includes(from) || !isDateTime(on)) return null;
  return { type: "state", to, from, on };
};

const indentColumns = (text: string): number => {
  let columns = 0;
  for (const char of text) {
    if (char === " ") columns += 1;
    else if (char === "\t") columns += 2;
    else break;
  }
  return columns;
};

/** Removes leading whitespace up to a number of columns. */
const stripColumns = (text: string, columns: number): string => {
  let used = 0;
  let i = 0;
  for (; i < text.length; i += 1) {
    const width = text[i] === "\t" ? 2 : text[i] === " " ? 1 : Infinity;
    if (used + width > columns) break;
    used += width;
  }
  return text.slice(i);
};

/** Attaches each task's body: spec/05-logbook.md §1. */
const readBodies = (lines: readonly Line[], tasks: readonly Task[]): void => {
  for (const task of tasks) {
    const own = indentColumns(task.indent);
    const strip = own + 2;
    const body: string[] = [];
    let i = task.line;
    let lastContent = task.line;
    for (; i < lines.length; i += 1) {
      const line = lines[i] as Line;
      const text = stripCarriageReturn(line.text);
      if (text.trim() === "") {
        if (line.kind !== "passthrough") break;
        body.push("");
        continue;
      }
      if (line.kind !== "passthrough" || indentColumns(text) <= own) break;
      body.push(stripColumns(text, strip));
      lastContent = i + 1;
    }
    task.body = body.slice(0, lastContent - task.line);
    task.bodyEnd = lastContent;
    task.log = task.body.flatMap((text) => {
      const entry = parseLogEntry(text);
      return entry === null ? [] : [entry];
    });
  }
};

/** Counts each task's direct children: spec/01-core.md §2. */
export const readProgress = (tasks: readonly Task[]): void => {
  for (const task of tasks) task.progress = null;
  for (const task of tasks) {
    if (task.parent === null) continue;
    const parent = tasks[task.parent - 1] as Task;
    const progress = (parent.progress ??= { done: 0, total: 0 });
    progress.total += 1;
    if (isClosed(task.state)) progress.done += 1;
  }
};

/** Reads one task line. `lineNumber` is 1-based and `index` is its place in the task list. */
const parseTask = (raw: string, match: RegExpExecArray, lineNumber: number, index: number): Task => {
  const [, indent, marker, , box] = match as unknown as [string, string, string, string, string];
  const text = stripCarriageReturn(raw);
  const bodyStart = text.length - stripCarriageReturn(match[5] as string).length;
  let content = text.slice(bodyStart);
  const trailerMatch = TRAILER.exec(content);
  let id: string | null = null;
  let rev: string | null = null;
  if (trailerMatch !== null) {
    content = content.slice(0, trailerMatch.index);
    for (const word of (trailerMatch[1] as string).split(/\s+/)) {
      if (word.startsWith("id:")) id = word.slice(3);
      else if (word.startsWith("rev:")) rev = word.slice(4);
    }
  }
  const { titleWords, run } = splitTokenRun(wordsIn(content, bodyStart));
  const fields: Fields = {
    status: null,
    context: null,
    project: null,
    nodeKind: null,
    energy: null,
    waitingReason: null,
    due: null,
    defer: null,
    warnDays: null,
    at: null,
    remind: null,
    estimateMinutes: null,
    priority: null,
    today: null,
    completed: null,
    habit: false,
  };
  for (const token of run) {
    const setter = SETTERS[token.key];
    if (setter !== undefined) token.isUsed = setter(token.value, fields);
  }
  const recurrence = readRule(run);
  let dueTime: string | null = null;
  for (const token of run) {
    if (token.key === "@due-time:" && fields.due !== null && isTime(token.value)) {
      dueTime = token.value;
      token.isUsed = true;
    }
  }
  const checked = box !== " ";
  const fallback: State = checked ? "done" : "inbox";
  let state = fields.status ?? fallback;
  const extraTokens = run.filter((token) => !token.isUsed).map((token) => token.text);
  if (state === "waiting" && fields.waitingReason === null) {
    state = fallback;
    extraTokens.push("@status:waiting");
  }
  const title = titleWords.map((word) => word.text).join(" ");
  return {
    line: lineNumber,
    index,
    title,
    rawTitle: title,
    state,
    checked,
    checkChar: box,
    marker,
    indent,
    depth: depthOf(indent),
    parent: null,
    tags: readTags(title),
    extraTokens,
    tokens: run,
    context: fields.context,
    project: fields.project,
    nodeKind: fields.nodeKind,
    energy: fields.energy,
    waitingReason: fields.waitingReason,
    due: fields.due,
    defer: fields.defer,
    dueTime,
    warnDays: fields.warnDays,
    at: fields.at,
    remind: fields.remind,
    estimateMinutes: fields.estimateMinutes,
    priority: fields.priority,
    today: fields.today,
    completed: fields.completed,
    habit: fields.habit,
    progress: null,
    recurrence,
    id,
    rev,
    body: [],
    log: [],
    bodyEnd: lineNumber,
    note: "",
    section: null,
    contentEnd: bodyStart + content.length,
  };
};

/** The tags in a run of title text, without code spans: spec/01-core.md §3.3. */
export const readTags = (title: string): string[] => {
  const words = title.replace(/`[^`]*`/g, " ").split(/\s+/);
  return [...new Set(words.filter((word) => TAG.test(word)).map((word) => word.slice(1)))];
};

/** Parses a document with Core rules. Never throws: bad input degrades to title text or extras. */
export const parseCore = (text: string, path = "", profile: Profile = "core"): Doc => {
  const texts = text.split("\n");
  const opaque = opaqueLines(texts);
  const tasks: Task[] = [];
  const stack: Task[] = [];
  const lines: Line[] = texts.map((raw, i): Line => {
    if (opaque[i] === true) return { kind: "opaque", text: raw };
    const clean = stripCarriageReturn(raw);
    const match = TASK.exec(clean);
    if (match !== null) {
      const task = parseTask(raw, match, i + 1, tasks.length + 1);
      while ((stack.at(-1)?.depth ?? -1) >= task.depth) stack.pop();
      task.parent = stack.at(-1)?.index ?? null;
      stack.push(task);
      tasks.push(task);
      return { kind: "task", text: raw, task };
    }
    if (SECTION.test(clean)) {
      stack.length = 0;
      return { kind: "section", text: raw };
    }
    const kind: LineKind = "passthrough";
    return { kind, text: raw };
  });
  readBodies(lines, tasks);
  readProgress(tasks);
  return { lines, tasks, profile, path };
};

/** The last line of a fence or comment block starting at `start`, or null if none starts there. */
export const blockEndOfFence = (texts: readonly string[], start: number): number | null => {
  const text = stripCarriageReturn(texts[start] as string);
  return REGION_OPEN.test(text) ? null : blockEnd(texts, start, text);
};

/** Words a title may not end in, because the reader would take them as a token. */
export const opensToken = (word: string): boolean => OPENS_TOKEN.test(word);

export { TASK, RULE_KEYS, stripCarriageReturn, indentColumns };
