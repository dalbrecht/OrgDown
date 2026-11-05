// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { renderView, type ViewName } from "../src/agenda.js";
import { validate, type Diagnostic } from "../src/diagnostics.js";
import { RefusedError, type Task } from "../src/model.js";
import { complete, reopen, skip } from "../src/operations.js";
import { parseCore } from "../src/parse.js";
import { completeTasksMd, fix, parseTasksMd } from "../src/tasks-md.js";

/**
 * Two implementations written apart should agree on inputs neither was tested on. The Python one
 * came from the spec alone, so a disagreement here is a bug in one of them, or a gap in the spec.
 */
const PYTHON = join(import.meta.dirname, "..", "implementations", "python", "orgdown.py");
const TODAY = "2026-11-04";
const ROUNDS = Number(process.env["ORGDOWN_FUZZ_ROUNDS"] ?? 1500);

const WORDS = [
  "Buy",
  "milk",
  "#home",
  "#work/q4",
  "re:",
  "<http://x.y/z>",
  "http://x.y/z",
  "`due:2026-01-01`",
  "@status:next",
  "@status:waiting",
  "@status:done",
  "@status:trash",
  "@status:frozen",
  "@context:Home",
  '@context:"Home Office"',
  "@energy:low",
  "@energy:huge",
  "due:2026-11-04",
  "due:2026-11-05",
  "due:2026-13-40",
  "defer:2026-11-01",
  "defer:2026-02-30",
  '@waiting:"a b"',
  "@waiting:x",
  "@kind:project",
  "@bogus:1",
  "@x-a:1",
  "@priority:1",
  "@priority:0",
  "@today:2026-11-04",
  "completed:2026-11-01",
  "@every:1w",
  "@every:0w",
  "@after:3m",
  "@every:1m",
  "@repeat-on:mon,thu",
  "@repeat-on:funday",
  "@repeat-count:2",
  "@repeat-count:0",
  "@repeat-until:2026-12-01",
  "@repeat-catch-up:yes",
  "@habit:yes",
  "@due-time:09:30",
  "@warn:3d",
  "at:2026-11-04T14:00/15:00",
  "at:2026-11-04",
  "@remind:2026-11-03T09:00",
  "@estimate:1h",
  "@Status:x",
  '"q',
  'z"',
  "@project:P",
  "<!-- id:a rev:b -->",
];
const LEADS = ["- ", "- ", "- ", "* ", "+ ", "  - ", "    - ", "\t- ", " - ", "1. ", "## ", "# ", "text "];
const BOXES = ["[ ] ", "[ ] ", "[x] ", "[X] ", "[ ]", "", "[y] "];
const NOTES = ["", "", "  a note", "  - a bullet", "  - clock:2026-11-04T09:00/10:30", "  - clock:2026-11-04T09:00/"];
const SECTIONS = ["## Active", "## Waiting On", "## Someday", "## Done", "## Ideas", "```", "<!--", "-->"];

/** A small repeatable generator, so a failure names a seed anyone can replay. */
const generator = (seed: number) => {
  let state = seed;
  const below = (limit: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state >> 8) % limit;
  };
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  return { below, pick };
};

const randomDocument = (seed: number): string => {
  const { below, pick } = generator(seed);
  const lines: string[] = [];
  for (let i = 0, count = 1 + below(8); i < count; i += 1) {
    if (below(6) === 0) lines.push(pick(SECTIONS));
    const words = Array.from({ length: below(6) }, () => pick(WORDS));
    lines.push(`${pick(LEADS)}${pick(BOXES)}${words.join(pick([" ", " ", "  "]))}`);
    if (below(4) === 0) lines.push(pick(NOTES));
  }
  return lines.join("\n");
};

const FIELDS: (keyof Task)[] = [
  "title",
  "state",
  "depth",
  "checked",
  "marker",
  "tags",
  "extraTokens",
  "context",
  "project",
  "nodeKind",
  "energy",
  "waitingReason",
  "due",
  "defer",
  "dueTime",
  "warnDays",
  "at",
  "remind",
  "estimateMinutes",
  "priority",
  "today",
  "completed",
  "recurrence",
  "habit",
  "progress",
  "id",
  "rev",
  "body",
  "log",
];

const orRefused = (run: () => string): unknown => {
  try {
    return run();
  } catch (error) {
    if (error instanceof RefusedError) return { refused: true };
    throw error;
  }
};

type Request = Record<string, unknown>;

/** What the reference gives for a request, in the shape a vector's `expect` holds. */
const reference = (request: Request): unknown => {
  const input = request["input"] as string;
  const line = request["line"] as number;
  const isBoard = request["profile"] === "tasks-md";
  switch (request["op"]) {
    case "parse": {
      const doc = isBoard ? parseTasksMd(input) : parseCore(input);
      const tasks = doc.tasks.map((task) => Object.fromEntries(FIELDS.map((name) => [name, task[name] ?? null])));
      return { kinds: doc.lines.map(({ kind }) => kind), tasks };
    }
    case "complete":
      return orRefused(() => (isBoard ? completeTasksMd(input, line, TODAY) : complete(parseCore(input), line, TODAY)));
    case "reopen":
      return orRefused(() => reopen(parseCore(input), line));
    case "skip":
      return orRefused(() => skip(parseCore(input), line, TODAY));
    case "fix":
      return fix(input);
    case "view": {
      const docs = (request["docs"] as { path: string; text: string }[]).map(({ path, text }) => parseCore(text, path));
      return renderView(request["view"] as ViewName, {}, docs, TODAY);
    }
    default:
      return validate(input, "a.md", (request["profile"] as "core" | "tasks-md" | "tasks-v2") ?? "core").map(
        ({ code, line: at, severity }) => ({ code, line: at, severity }),
      );
  }
};

/** Drops what Python adds beyond the fields under comparison. */
const comparable = (request: Request, answer: unknown): unknown => {
  if (request["op"] === "validate") {
    return (answer as Diagnostic[]).map(({ code, line, severity }) => ({ code, line, severity }));
  }
  if (request["op"] !== "parse") return answer;
  const { kinds, tasks } = answer as { kinds: string[]; tasks: Record<string, unknown>[] };
  return {
    kinds,
    tasks: tasks.map((task) => Object.fromEntries(FIELDS.map((name) => [name, task[name] ?? null]))),
  };
};

const VIEWS = ["day", "week", "list", "next", "waiting", "stuck", "logbook", "clock", "habits"];

const requests = (): Request[] => {
  const all: Request[] = [];
  for (let seed = 1; seed <= ROUNDS; seed += 1) {
    const input = randomDocument(seed);
    const { pick } = generator(seed);
    const taskLines = parseCore(input).tasks.map((task) => task.line);
    all.push({ op: "parse", input }, { op: "parse", profile: "tasks-md", input });
    all.push({ op: "validate", input }, { op: "validate", profile: "tasks-md", input });
    all.push({ op: "validate", profile: "tasks-v2", input }, { op: "fix", profile: "tasks-md", input });
    all.push({ op: "view", view: pick(VIEWS), docs: [{ path: "a.md", text: input }], today: TODAY });
    if (taskLines.length > 0) {
      const line = pick(taskLines);
      for (const op of ["complete", "reopen", "skip"]) all.push({ op, input, line, today: TODAY });
      all.push({ op: "complete", profile: "tasks-md", input, line, today: TODAY });
    }
  }
  return all;
};

const hasPython = spawnSync("python3", ["--version"]).status === 0;

describe.skipIf(!hasPython)("the Python implementation", () => {
  it("should agree with the reference on random documents", () => {
    const all = requests();
    const server = spawnSync("python3", ["-I", PYTHON, "--serve"], {
      input: all.map((request) => JSON.stringify(request)).join("\n"),
      encoding: "utf8",
      maxBuffer: 1 << 30,
    });
    const answers = server.stdout.trim().split("\n");
    expect(answers).toHaveLength(all.length);
    const disagreements = all.flatMap((request, i) => {
      const theirs = comparable(request, JSON.parse(answers[i] as string));
      const ours = reference(request);
      return isDeepStrictEqual(ours, theirs) ? [] : [{ request, ours, theirs }];
    });
    const report = process.env["ORGDOWN_DIFF_REPORT"];
    if (report !== undefined) writeFileSync(report, JSON.stringify(disagreements));
    expect(disagreements.slice(0, 5)).toEqual([]);
  });
});
