// SPDX-License-Identifier: MIT
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { regenerate, renderView, type Attrs, type ViewName } from "../src/agenda.js";
import { validate } from "../src/diagnostics.js";
import { AgendaError, RefusedError, type Profile, type Recurrence } from "../src/model.js";
import { add, archive, clockIn, clockOut, complete, reopen, skip, trash } from "../src/operations.js";
import { parseCore } from "../src/parse.js";
import { parseQuery } from "../src/query.js";
import { nextOccurrence } from "../src/recurrence.js";
import {
  addTasksMd,
  completeTasksMd,
  fix,
  fromCore,
  parseAuto,
  parseTasksMd,
  reopenTasksMd,
  toCore,
} from "../src/tasks-md.js";

/** One vector. Fields vary by op, as conformance/README.md describes. */
type Case = Record<string, unknown> & { id: string; op?: string; profile?: Profile };

const VECTORS = join(import.meta.dirname, "..", "conformance", "vectors");

const docFor = (input: string, profile: Profile | undefined, path = "a.md") =>
  profile === "tasks-md" ? parseTasksMd(input) : parseCore(input, path, profile);

const orRefused = (run: () => string): unknown => {
  try {
    return run();
  } catch (error) {
    if (error instanceof RefusedError) return { refused: true };
    throw error;
  }
};

const orError = (run: () => unknown): unknown => {
  try {
    return run();
  } catch (error) {
    if (error instanceof AgendaError) return { error: true };
    throw error;
  }
};

const parsed = (vector: Case) => {
  const doc = docFor(vector["input"] as string, vector.profile);
  return { kinds: doc.lines.map((line) => line.kind), tasks: doc.tasks };
};

const checkParse = (vector: Case): void => {
  const expected = vector["expect"] as { kinds?: string[]; tasks: Record<string, unknown>[] };
  const actual = parsed(vector);
  if (expected.kinds !== undefined) expect(actual.kinds).toEqual(expected.kinds);
  expect(actual.tasks).toHaveLength(expected.tasks.length);
  expected.tasks.forEach((fields, i) => {
    const task = actual.tasks[i] as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(fields)) expect(task[name] ?? null, name).toEqual(value);
  });
};

const run = (vector: Case): unknown => {
  const input = vector["input"] as string;
  const line = vector["line"] as number;
  const today = vector["today"] as string;
  const now = vector["now"] as string;
  const isBoard = vector.profile === "tasks-md";
  const doc = (): ReturnType<typeof docFor> => docFor(input, undefined);
  switch (vector.op) {
    case "next":
      return nextOccurrence(
        vector["rule"] as Recurrence,
        vector["anchor"] as string,
        (vector["completed"] as string) ?? null,
        today,
      );
    case "complete":
      return orRefused(() => (isBoard ? completeTasksMd(input, line, today) : complete(doc(), line, today)));
    case "trash":
      return orRefused(() => trash(doc(), line, today));
    case "reopen":
      return orRefused(() => (isBoard ? reopenTasksMd(input, line) : reopen(doc(), line)));
    case "skip":
      return orRefused(() => skip(doc(), line, today));
    case "add":
      return orRefused(() => {
        const [title, tokens] = [vector["title"] as string, vector["tokens"] as string[]];
        const section = vector["section"] as string | undefined;
        if (isBoard) return addTasksMd(input, title, tokens, section, vector["note"] as string | undefined);
        return add(doc(), title, tokens, section);
      });
    case "archive":
      try {
        return archive(doc(), line);
      } catch (error) {
        if (error instanceof RefusedError) return { refused: true };
        throw error;
      }
    case "clockIn":
      return orRefused(() => clockIn(doc(), line, now));
    case "clockOut":
      return orRefused(() => clockOut(doc(), line, now));
    case "query":
      return orError(() => {
        const current = parseCore(input, (vector["path"] as string) ?? "a.md");
        const matches = parseQuery(vector["query"] as string, today);
        return current.tasks.filter((task) => matches(task, current)).map((task) => task.title);
      });
    case "view": {
      const docs = (vector["docs"] as { path: string; text: string }[]).map((file) => parseAuto(file.text, file.path));
      return renderView(vector["view"] as ViewName, (vector["attrs"] as Attrs) ?? {}, docs, today);
    }
    case "agendaMd":
      return orError(() =>
        regenerate(input, vector["path"] as string, vector["files"] as { path: string; text: string }[], today),
      );
    case "validate":
      return validate(input, "a.md", vector.profile ?? "core").map(({ code, line: at, severity }) => ({
        code,
        line: at,
        severity,
      }));
    case "fix":
      return fix(input);
    case "toCore":
      return toCore(input);
    case "fromCore": {
      const { text, warnings } = fromCore(input);
      return { text, warnings: warnings.length };
    }
    default:
      throw new Error(`unknown op ${vector.op}`);
  }
};

for (const file of readdirSync(VECTORS)) {
  const { module, op, cases } = JSON.parse(readFileSync(join(VECTORS, file), "utf8")) as {
    module: string;
    op: string;
    cases: Case[];
  };
  describe(module, () => {
    for (const vector of cases) {
      const current = { ...vector, op: vector.op ?? op };
      it(current.id, () => {
        if (current.op === "parse") checkParse(current);
        else expect(run(current)).toEqual((vector as Record<string, unknown>)["expect"]);
      });
    }
  });
}
