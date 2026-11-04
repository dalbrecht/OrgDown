// SPDX-License-Identifier: MIT
/** The validator: spec/07-diagnostics.md. */
import { findRegions, checkView } from "./agenda.js";
import { isDateTime, isTime, toMinutes } from "./dates.js";
import { AgendaError, isClosed, type Doc, type Profile, type Task, type Token } from "./model.js";
import {
  RULE_KEYS,
  TASK,
  isRuleTokenValid,
  indentColumns,
  opensToken,
  parseCore,
  stripCarriageReturn,
} from "./parse.js";
import { SECTION_RULES, explicitStatus, headingOf, parseTasksMd, profileFor, titleParts } from "./tasks-md.js";

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  line: number;
  message: string;
}

const CORE_KEYS = ["@status:", "@context:", "@project:", "@kind:", "@energy:", "@waiting:", "due:", "defer:"];
const PLANNING_KEYS = [
  "@habit:",
  "@due-time:",
  "@warn:",
  "at:",
  "@remind:",
  "@estimate:",
  "@priority:",
  "@today:",
  "completed:",
];
const KNOWN_KEYS = [...CORE_KEYS, ...PLANNING_KEYS, ...RULE_KEYS];
const PROSE_DATE =
  /\b(?:due|by)\s+(?:today|tomorrow|next\s+\w+|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b/i;

const SEVERITIES: Record<string, Severity> = {
  OD101: "error",
  OD102: "error",
  OD103: "warning",
  OD104: "warning",
  OD105: "warning",
  OD106: "error",
  OD107: "error",
  OD108: "warning",
  OD109: "warning",
  OD111: "warning",
  OD112: "warning",
  OD113: "warning",
  OD114: "warning",
  OD201: "error",
  OD202: "error",
  OD203: "error",
  OD204: "warning",
  OD205: "warning",
  OD206: "warning",
  OD301: "error",
  OD302: "warning",
  OD401: "error",
  OD402: "error",
  OD403: "error",
  OD501: "warning",
  OD502: "error",
  OD503: "error",
  OD504: "warning",
  OD601: "error",
  OD602: "error",
  OD603: "warning",
  OD604: "warning",
  OD605: "warning",
  OD606: "warning",
  OD607: "warning",
};

const diagnostic = (code: string, line: number, message: string): Diagnostic => ({
  code,
  severity: SEVERITIES[code] as Severity,
  line,
  message,
});

const isPrimaryRuleKey = (key: string): boolean => key === "@every:" || key === "@after:";

/** A token is shadowed when a later valid token sets the same key: spec/03-recurrence.md §2. */
const isShadowed = (task: Task, token: Token): boolean => {
  const sameKey = (other: Token): boolean =>
    other.isUsed && (other.key === token.key || (isPrimaryRuleKey(other.key) && isPrimaryRuleKey(token.key)));
  return task.tokens.filter(sameKey).at(-1) !== token;
};

/** Why a token ended up as an extra. A bad value outranks every other reason. */
const extraDiagnostic = (task: Task, token: Token): [string, string] | null => {
  const isRepeat = token.key.startsWith("@repeat-");
  if (token.key === "@due-time:") {
    if (isTime(token.value) && task.due === null) {
      const isLast = task.tokens.filter(({ key, value }) => key === token.key && isTime(value)).at(-1) === token;
      return isLast ? ["OD107", `"${token.text}" needs a valid due:`] : null;
    }
    return ["OD101", `"${token.text}" is not a valid value`];
  }
  if (RULE_KEYS.includes(token.key) && !isRuleTokenValid(token)) {
    return ["OD101", `"${token.text}" is not a valid value`];
  }
  if (isRepeat && task.recurrence === null) return ["OD201", `${token.key} needs a valid @every: or @after:`];
  if (token.key === "@repeat-on:") return ["OD202", "@repeat-on: only works with a unit of w"];
  if (token.key === "@repeat-catch-up:") return ["OD203", "@repeat-catch-up: only works with @every:"];
  if (KNOWN_KEYS.includes(token.key)) return ["OD101", `"${token.text}" is not a valid value`];
  if (token.key.startsWith("@x-")) return null;
  if (token.key.startsWith("@")) return ["OD104", `"${token.text}" is an unknown token`];
  return ["OD105", `"${token.text}" was read as a token, not title text. Wrap it in <> or code`];
};

const tokenDiagnostics = (task: Task): Diagnostic[] =>
  task.tokens.flatMap((token) => {
    if (!token.isUsed) {
      const reason = extraDiagnostic(task, token);
      return reason === null ? [] : [diagnostic(reason[0], task.line, reason[1])];
    }
    const found: Diagnostic[] = [];
    if (isShadowed(task, token)) {
      found.push(diagnostic("OD103", task.line, `a later token replaces "${token.text}"`));
    }
    if (token.key === "@project:" && !isShadowed(task, token)) {
      found.push(diagnostic("OD114", task.line, "nest under an @kind:project task instead of @project:"));
    }
    return found;
  });

const taskDiagnostics = (task: Task): Diagnostic[] => {
  const found = tokenDiagnostics(task);
  const add = (code: string, message: string): void => void found.push(diagnostic(code, task.line, message));
  const titleWords = task.rawTitle.split(/\s+/);
  if (titleWords.some((word) => opensToken(word) && KNOWN_KEYS.includes(word.slice(0, word.indexOf(":") + 1)))) {
    add("OD102", "text after a token ended the token run, so the tokens before it are title text");
  }
  if (
    task.extraTokens.at(-1) === "@status:waiting" &&
    !task.tokens.some((token) => !token.isUsed && token.text === "@status:waiting")
  ) {
    add("OD106", "@status:waiting needs a reason in @waiting:");
  }
  if (isClosed(task.state) !== task.checked) add("OD108", "the checkbox disagrees with @status:");
  if (task.completed !== null && !isClosed(task.state)) add("OD109", "completed: has no effect on an open line");
  if (task.priority !== null && isClosed(task.state)) add("OD111", "@priority: has no effect on a closed line");
  if (task.defer !== null && task.due !== null && task.defer > task.due) add("OD112", "defer: is after due:");
  if (indentColumns(task.indent) % 2 !== 0) add("OD113", "indentation is not a multiple of 2 columns");
  if (task.recurrence !== null && task.due === null)
    add("OD204", "a repeating task with no due: anchors on the completion day");
  if (task.recurrence?.count !== undefined && task.recurrence.until !== undefined)
    add("OD205", "whichever of @repeat-count: and @repeat-until: ends first wins");
  if (task.habit && task.recurrence === null) add("OD206", "a habit needs a recurrence rule");
  return found;
};

const logDiagnostics = (doc: Doc): Diagnostic[] => {
  const found: Diagnostic[] = [];
  let runningClocks = 0;
  for (const task of doc.tasks) {
    task.body.forEach((text, i) => {
      const clock = /^- clock:(\S+?)\/(\S+)$/.exec(text);
      if (clock === null || !isDateTime(clock[1] as string)) return;
      const start = clock[1] as string;
      const end = isTime(clock[2] as string) ? `${start.slice(0, 10)}T${clock[2]}` : (clock[2] as string);
      if (isDateTime(end) && toMinutes(end) <= toMinutes(start))
        found.push(diagnostic("OD301", task.line + i + 1, "a clock's end must be after its start"));
    });
    task.log.forEach((entry) => {
      if (entry.type !== "clock" || entry.end !== null) return;
      runningClocks += 1;
      if (runningClocks > 1)
        found.push(
          diagnostic(
            "OD302",
            task.line + task.body.findIndex((text) => text === `- clock:${entry.start}/`) + 1,
            "more than one clock is running",
          ),
        );
    });
  }
  return found;
};

const regionDiagnostics = (text: string): Diagnostic[] => {
  try {
    const found: Diagnostic[] = [];
    for (const region of findRegions(text)) {
      try {
        checkView(region.view, region.attrs, "2000-01-01", region.open + 1);
      } catch (error) {
        const failure = error as AgendaError;
        found.push(diagnostic(failure.code, failure.line, failure.message));
      }
    }
    return found;
  } catch (error) {
    const failure = error as AgendaError;
    return [diagnostic(failure.code, failure.line, failure.message)];
  }
};

const tasksV2Diagnostics = (doc: Doc): Diagnostic[] => {
  const found: Diagnostic[] = [];
  const seen = new Set<string>();
  doc.lines.forEach((line, i) => {
    const task = line.task;
    if (line.kind === "opaque" && TASK.test(stripCarriageReturn(line.text)))
      found.push(diagnostic("OD504", i + 1, "the current codec reads this as a task"));
    if (task === undefined) return;
    for (const token of task.tokens) {
      const isValidRuleToken = RULE_KEYS.includes(token.key) && isRuleTokenValid(token);
      const isValidDueTime = token.key === "@due-time:" && isTime(token.value);
      if ((token.isUsed || isValidRuleToken || isValidDueTime) && !CORE_KEYS.includes(token.key))
        found.push(diagnostic("OD501", i + 1, `${token.key} is inert until the codec reads it`));
      if (token.key === "@context:" && /\s/.test(token.value))
        found.push(diagnostic("OD502", i + 1, "the current codec can't read back a context with a space"));
    }
    if (task.id !== null && seen.has(task.id)) found.push(diagnostic("OD503", i + 1, `id ${task.id} appears twice`));
    if (task.id !== null) seen.add(task.id);
  });
  return found;
};

const tasksMdTaskDiagnostics = (task: Task, firstHeading: number): Diagnostic[] => {
  const found: Diagnostic[] = [];
  const add = (code: string, message: string): void => void found.push(diagnostic(code, task.line, message));
  if (task.marker !== "-" || task.checkChar === "X" || task.depth > 1) {
    add("OD603", "the dashboard rewrites this marker, or flattens this subtask");
  }
  if (task.line < firstHeading) add("OD602", "the dashboard drops a task before the first ## section");
  if (task.depth > 0) return found;
  if (!titleParts(task.rawTitle).isBold && task.tokens.length > 0)
    add("OD601", "without a bold title, the dashboard pulls tokens into the title");
  const rule = SECTION_RULES[task.section?.toLowerCase() ?? ""];
  const explicit = rule === undefined ? undefined : explicitStatus(task, rule);
  if (explicit !== undefined && explicit !== task.state)
    add("OD604", "this @status: does not fit the section, so the section wins");
  if (rule?.state === "done" && !task.checked) add("OD605", "an unchecked task in Done");
  if (task.due === null && PROSE_DATE.test(`${task.title} ${task.note}`))
    add("OD606", "this date is prose. Use a due: token");
  const hasReason = task.tokens.some((token) => token.key === "@waiting:" && token.isUsed);
  if (rule?.state === "waiting" && task.note === "" && !hasReason) add("OD607", "say who or what this is waiting on");
  return found;
};

const tasksMdDiagnostics = (doc: Doc): Diagnostic[] => {
  // The dashboard reads raw text, so these checks ignore fences: a fenced heading still opens a section.
  const heading = doc.lines.findIndex((line) => headingOf(line.text) !== null);
  const firstHeading = heading === -1 ? Infinity : heading + 1;
  const found = doc.tasks.flatMap((task) => tasksMdTaskDiagnostics(task, firstHeading));
  doc.lines.forEach((line, i) => {
    const text = stripCarriageReturn(line.text);
    if (line.task !== undefined || text.trim() === "" || text === "# Tasks" || headingOf(text) !== null) return;
    if (i + 1 > firstHeading && TASK.test(text)) return;
    found.push(diagnostic("OD602", i + 1, "the dashboard drops this line on save"));
  });
  return found;
};

const sorted = (found: Diagnostic[]): Diagnostic[] =>
  found.sort((a, b) => a.line - b.line || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

/** Validates a document. Never throws: reports what it finds, in line order. */
export const validate = (text: string, path: string, profile: Profile = profileFor(path)): Diagnostic[] => {
  const doc = profile === "tasks-md" ? parseTasksMd(text, path) : parseCore(text, path, profile);
  const found = [...doc.tasks.flatMap(taskDiagnostics), ...logDiagnostics(doc), ...regionDiagnostics(text)];
  if (profile === "tasks-v2") found.push(...tasksV2Diagnostics(doc));
  if (profile === "tasks-md") found.push(...tasksMdDiagnostics(doc));
  // A section outranks @status: in TASKS.md, so OD604 and OD605 say what OD108 would.
  return sorted(profile === "tasks-md" ? found.filter(({ code }) => code !== "OD108") : found);
};
