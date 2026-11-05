// SPDX-License-Identifier: MIT
/** The `orgdown` command. Arguments are parsed here, and the work happens in the modules. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { isDate, isDateTime } from "./dates.js";
import { VIEWS, regenerate, renderView, type Attrs, type ViewName } from "./agenda.js";
import { validate, type Diagnostic } from "./diagnostics.js";
import { appendToArchive, markdownFiles, writeIfUnchanged } from "./files.js";
import { AgendaError, RefusedError, type Doc, type Profile } from "./model.js";
import { add, archive, clockIn, clockOut, complete, reopen, skip, trash } from "./operations.js";
import { parseCore } from "./parse.js";
import {
  completeTasksMd,
  fix,
  addTasksMd,
  fromCore,
  parseAuto,
  profileFor,
  reopenTasksMd,
  toCore,
  trashTasksMd,
} from "./tasks-md.js";

const HELP = `orgdown: Org mode's task and agenda model in plain Markdown

Read
  orgdown validate [--profile core|tasks-md|tasks-v2] [--json] <file>...
  orgdown parse <file>
  orgdown agenda <view> [--match q] [--sort s] [--title t] [--start d] [--days n]
                 [--from d] [--to d] [--today d] <file or folder>...
    views: ${VIEWS.join(" ")}

Write (each keeps every other byte, and refuses if the file changed)
  orgdown complete|trash|reopen|skip <file> <line> [--expect text] [--today d]
  orgdown add <file> <title> [--section name] [--note text] [--token tok]...
  orgdown archive <file> <line> [--into Archive.md] [--expect text]
  orgdown clock-in|clock-out <file> <line> [--expect text] [--now YYYY-MM-DDTHH:MM]
  orgdown regenerate <agenda.md> [--check] [--today d]

TASKS.md
  orgdown fix <TASKS.md>
  orgdown convert <file> --to core|tasks-md

--expect refuses the edit unless the line contains that text, in case lines have moved.
--today defaults to the local date. Exit status is 0 on success, 1 on errors found or a refused
edit, and 2 on bad usage.
`;

interface Options {
  profile?: string;
  json?: boolean;
  match?: string;
  sort?: string;
  title?: string;
  start?: string;
  days?: string;
  from?: string;
  to?: string;
  today?: string;
  now?: string;
  expect?: string;
  section?: string;
  note?: string;
  into?: string;
  token?: string[];
  check?: boolean;
  to_format?: string;
  help?: boolean;
}

class UsageError extends Error {}

const localDate = (now: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const localDateTime = (now: Date): string =>
  `${localDate(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

const readArgument = (args: readonly string[], index: number, name: string): string => {
  const value = args[index];
  if (value === undefined) throw new UsageError(`missing ${name}`);
  return value;
};

const printDiagnostic = (path: string, { code, severity, line, message }: Diagnostic): void => {
  process.stdout.write(`${path}:${line}: ${severity} ${code}: ${message}\n`);
};

const runValidate = (paths: readonly string[], options: Options): number => {
  if (paths.length === 0) throw new UsageError("missing <file>");
  const reports = paths.map((path) => ({
    path,
    diagnostics: validate(
      readFileSync(path, "utf8"),
      path,
      (options.profile as Profile | undefined) ?? profileFor(path),
    ),
  }));
  if (options.json === true) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  else for (const { path, diagnostics } of reports) for (const one of diagnostics) printDiagnostic(path, one);
  return reports.some(({ diagnostics }) => diagnostics.some((one) => one.severity === "error")) ? 1 : 0;
};

const toJson = ({ lines: _lines, tasks, path, profile }: Doc): unknown => ({
  path,
  profile,
  tasks: tasks.map(({ tokens: _tokens, rawTitle: _rawTitle, contentEnd: _end, bodyEnd: _bodyEnd, ...task }) => task),
});

const docsAt = (targets: readonly string[]): Doc[] =>
  (targets.length === 0 ? ["."] : targets).flatMap((target) => {
    if (!statSync(target).isDirectory()) return [parseAuto(readFileSync(target, "utf8"), target)];
    const files = [...markdownFiles(target)].sort((a, b) => (a.path < b.path ? -1 : 1));
    return files.map((file) => parseAuto(file.text, target === "." ? file.path : `${target}/${file.path}`));
  });

const attrsFrom = (options: Options): Attrs => {
  const attrs: Attrs = {};
  for (const name of ["match", "sort", "title", "start", "days", "from", "to"] as const) {
    const value = options[name];
    if (value !== undefined) attrs[name] = value;
  }
  return attrs;
};

const edit = (path: string, change: (text: string) => string, options: Options, line?: number): number => {
  const text = readFileSync(path, "utf8");
  if (line !== undefined && options.expect !== undefined && !text.split("\n")[line - 1]?.includes(options.expect)) {
    throw new RefusedError(`line ${line} of ${path} doesn't contain "${options.expect}"`);
  }
  const changed = change(text);
  if (changed !== text) writeIfUnchanged(path, text, changed);
  return 0;
};

/**
 * The plugin's PostToolUse hook. It reads the tool call from stdin, and exits 2 with the problems on
 * stderr, which is how a hook hands feedback back to Claude. It must never break the write it's
 * checking, so anything it can't read is ignored.
 */
const runHook = (input: string): number => {
  let path: unknown;
  try {
    path = (JSON.parse(input) as { tool_input?: { file_path?: unknown } }).tool_input?.file_path;
  } catch {
    return 0;
  }
  if (typeof path !== "string" || profileFor(path) === "core" || !existsSync(path)) return 0;
  const problems = validate(readFileSync(path, "utf8"), path).filter((one) => one.severity === "error");
  if (problems.length === 0) return 0;
  // Codes and line numbers only: messages quote the file, and this text goes straight to the model.
  const lines = problems.map(({ code, line }) => `line ${line}: ${code}`);
  const name = basename(path);
  process.stderr.write(
    `${name} has OrgDown problems. Run orgdown validate on it and fix them, or tools may lose data:\n${lines.join("\n")}\n`,
  );
  return 2;
};

const asLine = (text: string): number => {
  if (!/^[1-9]\d*$/.test(text)) throw new UsageError(`"${text}" is not a line number`);
  return Number(text);
};

type LineCommand = (text: string, path: string, line: number) => string;

const lineCommands = (today: string, now: string): Record<string, LineCommand> => {
  const isBoard = (path: string): boolean => profileFor(path) === "tasks-md";
  const core = (text: string, path: string): Doc => parseCore(text, path);
  return {
    complete: (text, path, line) =>
      isBoard(path) ? completeTasksMd(text, line, today) : complete(core(text, path), line, today),
    trash: (text, path, line) =>
      isBoard(path) ? trashTasksMd(text, line, today) : trash(core(text, path), line, today),
    reopen: (text, path, line) => (isBoard(path) ? reopenTasksMd(text, line) : reopen(core(text, path), line)),
    skip: (text, path, line) => skip(core(text, path), line, today),
    "clock-in": (text, path, line) => clockIn(core(text, path), line, now),
    "clock-out": (text, path, line) => clockOut(core(text, path), line, now),
  };
};

const runArchive = (path: string, line: number, options: Options): number => {
  const target = options.into ?? `${dirname(path)}/Archive.md`;
  const text = readFileSync(path, "utf8");
  if (options.expect !== undefined && !text.split("\n")[line - 1]?.includes(options.expect)) {
    throw new RefusedError(`line ${line} of ${path} doesn't contain "${options.expect}"`);
  }
  const { text: kept, removed } = archive(parseCore(text, path), line);
  if (readFileSync(path, "utf8") !== text) throw new RefusedError(`${path} changed while it was being edited`);
  appendToArchive(target, path, `${removed}\n`);
  writeIfUnchanged(path, text, kept);
  return 0;
};

const runRegenerate = (path: string, options: Options, today: string): number => {
  const absolute = resolve(path);
  const root = dirname(absolute);
  const text = readFileSync(absolute, "utf8");
  const name = relative(root, absolute).split(sep).join("/");
  const output = regenerate(text, name, markdownFiles(root), today);
  if (options.check === true) {
    if (output !== text) process.stdout.write(`${path} is out of date\n`);
    return output === text ? 0 : 1;
  }
  if (output !== text) writeIfUnchanged(absolute, text, output);
  return 0;
};

const runConvert = (path: string, target: string | undefined): number => {
  const text = readFileSync(path, "utf8");
  if (target === "core") {
    process.stdout.write(toCore(text));
    return 0;
  }
  if (target !== "tasks-md") throw new UsageError("--to must be core or tasks-md");
  const { text: output, warnings } = fromCore(text);
  process.stdout.write(output);
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
  return 0;
};

/** Runs the command line, and returns the exit status. */
export const main = (
  argv: readonly string[],
  clock: Date = new Date(),
  stdin: () => string = () => readFileSync(0, "utf8"),
): number => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      profile: { type: "string" },
      json: { type: "boolean" },
      match: { type: "string" },
      sort: { type: "string" },
      title: { type: "string" },
      start: { type: "string" },
      days: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      today: { type: "string" },
      now: { type: "string" },
      expect: { type: "string" },
      section: { type: "string" },
      note: { type: "string" },
      into: { type: "string" },
      token: { type: "string", multiple: true },
      check: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const options = values as Options;
  const [command, ...args] = positionals;
  if (command === undefined || options.help === true) {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.today !== undefined && !isDate(options.today)) throw new UsageError(`"${options.today}" is not a date`);
  if (options.now !== undefined && !isDateTime(options.now)) throw new UsageError(`"${options.now}" is not a datetime`);
  const today = options.today ?? localDate(clock);
  const lineCommand = lineCommands(today, options.now ?? localDateTime(clock))[command];
  if (lineCommand !== undefined) {
    const path = readArgument(args, 0, "<file>");
    const line = asLine(readArgument(args, 1, "<line>"));
    return edit(path, (text) => lineCommand(text, path, line), options, line);
  }
  switch (command) {
    case "validate":
      return runValidate(args, options);
    case "parse": {
      const path = readArgument(args, 0, "<file>");
      process.stdout.write(
        `${JSON.stringify(toJson(parseAuto(readFileSync(path, "utf8"), basename(path))), null, 2)}\n`,
      );
      return 0;
    }
    case "agenda": {
      const view = readArgument(args, 0, "<view>");
      if (!(VIEWS as readonly string[]).includes(view)) throw new UsageError(`"${view}" is not a view`);
      process.stdout.write(`${renderView(view as ViewName, attrsFrom(options), docsAt(args.slice(1)), today)}\n`);
      return 0;
    }
    case "add": {
      const path = readArgument(args, 0, "<file>");
      const title = readArgument(args, 1, "<title>");
      const tokens = options.token ?? [];
      return edit(
        path,
        (text) =>
          profileFor(path) === "tasks-md"
            ? addTasksMd(text, title, tokens, options.section, options.note)
            : add(parseCore(text, path), title, tokens, options.section),
        options,
      );
    }
    case "archive":
      return runArchive(readArgument(args, 0, "<file>"), asLine(readArgument(args, 1, "<line>")), options);
    case "hook":
      return runHook(stdin());
    case "regenerate":
      return runRegenerate(readArgument(args, 0, "<agenda.md>"), options, today);
    case "fix":
      return edit(readArgument(args, 0, "<file>"), fix, options);
    case "convert":
      return runConvert(readArgument(args, 0, "<file>"), options.to);
    default:
      throw new UsageError(`"${command}" is not a command`);
  }
};

const entry = process.argv[1];
if (entry !== undefined && existsSync(entry) && /orgdown(\.mjs)?$/.test(entry)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    const isUsage =
      error instanceof UsageError || (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS") === true;
    const isExpected =
      error instanceof RefusedError ||
      error instanceof AgendaError ||
      (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!isUsage && !isExpected) throw error;
    process.stderr.write(`orgdown: ${(error as Error).message}\n`);
    process.exitCode = isUsage ? 2 : 1;
  }
}
