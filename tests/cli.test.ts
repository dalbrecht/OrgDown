// SPDX-License-Identifier: MIT
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { markdownFiles, writeIfUnchanged } from "../src/files.js";
import { AgendaError, RefusedError } from "../src/model.js";

const CLOCK = new Date(2026, 10, 4, 9, 5);

let folder: string;
let written: string[];
let errors: string[];

const file = (name: string, text: string): string => {
  const path = join(folder, name);
  writeFileSync(path, text);
  return path;
};

const output = (): string => written.join("");

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "orgdown-"));
  written = [];
  errors = [];
  vi.spyOn(process.stdout, "write").mockImplementation((text) => (written.push(String(text)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((text) => (errors.push(String(text)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("help", () => {
  it("should print usage with no command", () => {
    expect(main([], CLOCK)).toBe(0);
    expect(output()).toContain("orgdown validate");
  });

  it("should print usage with --help", () => {
    expect(main(["complete", "--help"], CLOCK)).toBe(0);
    expect(output()).toContain("orgdown validate");
  });
});

describe("validate", () => {
  it("should exit 0 on a clean file", () => {
    expect(main(["validate", file("a.md", "- [ ] Fine\n")], CLOCK)).toBe(0);
    expect(output()).toBe("");
  });

  it("should exit 1 and print each problem", () => {
    const path = file("a.md", "- [ ] Bad due:2026-13-40\n");
    expect(main(["validate", path], CLOCK)).toBe(1);
    expect(output()).toContain(`${path}:1: error OD101:`);
  });

  it("should exit 0 on warnings", () => {
    expect(main(["validate", file("a.md", "- [ ] a @bogus:1\n")], CLOCK)).toBe(0);
    expect(output()).toContain("warning OD104");
  });

  it("should print JSON", () => {
    main(["validate", "--json", file("a.md", "- [ ] a @bogus:1\n")], CLOCK);
    expect((JSON.parse(output()) as { diagnostics: { code: string }[] }[])[0]?.diagnostics[0]?.code).toBe("OD104");
  });

  it("should pick the profile from the file name", () => {
    main(["validate", file("TASKS.md", "## Active\nprose\n")], CLOCK);
    expect(output()).toContain("OD602");
  });

  it("should take an explicit profile", () => {
    main(["validate", "--profile", "tasks-v2", file("a.md", "- [ ] a @priority:1\n")], CLOCK);
    expect(output()).toContain("OD501");
  });

  it("should need a file", () => {
    expect(() => main(["validate"], CLOCK)).toThrow("missing <file>");
  });
});

describe("parse", () => {
  it("should print tasks as JSON, without internal fields", () => {
    main(["parse", file("a.md", "- [ ] a due:2026-11-04\n")], CLOCK);
    const { tasks } = JSON.parse(output()) as { tasks: Record<string, unknown>[] };
    expect(tasks[0]?.["due"]).toBe("2026-11-04");
    expect(tasks[0]).not.toHaveProperty("contentEnd");
  });
});

describe("agenda", () => {
  it("should render a view of a file, using the local date", () => {
    main(["agenda", "day", file("a.md", "- [ ] a due:2026-11-04\n")], CLOCK);
    expect(output()).toContain("Today (2026-11-04)");
    expect(output()).toContain("due today");
  });

  it("should take --today and view options", () => {
    main(
      [
        "agenda",
        "list",
        "--match",
        "open",
        "--title",
        "Mine",
        "--today",
        "2026-01-01",
        file("a.md", "- [ ] a\n- [x] b\n"),
      ],
      CLOCK,
    );
    expect(output()).toContain("## Mine");
    expect(output()).not.toContain("- b");
  });

  it("should read a folder, skipping dependencies", () => {
    file("a.md", "- [ ] a\n");
    mkdirSync(join(folder, "node_modules"));
    file("node_modules/b.md", "- [ ] b\n");
    mkdirSync(join(folder, "sub"));
    file("sub/c.md", "- [ ] c\n");
    main(["agenda", "list", folder], CLOCK);
    expect(output()).toContain("- a");
    expect(output()).toContain("- c");
    expect(output()).not.toContain("- b");
  });

  it("should default to the current folder", () => {
    file("a.md", "- [ ] Here\n");
    vi.spyOn(process, "cwd").mockReturnValue(folder);
    const previous = process.cwd;
    process.chdir(folder);
    main(["agenda", "list"], CLOCK);
    process.cwd = previous;
    expect(output()).toContain("- Here");
  });

  it("should refuse an unknown view", () => {
    expect(() => main(["agenda", "month"], CLOCK)).toThrow("not a view");
  });

  it("should refuse a bad query", () => {
    expect(() => main(["agenda", "list", "--match", "nope:1", file("a.md", "")], CLOCK)).toThrow(AgendaError);
  });
});

describe("line commands", () => {
  it("should complete a task in place", () => {
    const path = file("a.md", "- [ ] a\n");
    expect(main(["complete", path, "1", "--today", "2026-11-04"], CLOCK)).toBe(0);
    expect(readFileSync(path, "utf8")).toBe("- [x] a completed:2026-11-04\n");
  });

  it("should refuse when --expect does not match", () => {
    const path = file("a.md", "- [ ] a\n");
    expect(() => main(["complete", path, "1", "--expect", "other"], CLOCK)).toThrow(RefusedError);
    expect(readFileSync(path, "utf8")).toBe("- [ ] a\n");
  });

  it("should apply when --expect matches", () => {
    const path = file("a.md", "- [ ] Water\n");
    main(["complete", path, "1", "--expect", "Water"], CLOCK);
    expect(readFileSync(path, "utf8")).toContain("completed:2026-11-04");
  });

  it("should use the board rules for TASKS.md", () => {
    const path = file("TASKS.md", "## Active\n- [ ] **a**\n## Done\n");
    main(["complete", path, "2"], CLOCK);
    expect(readFileSync(path, "utf8")).toBe("## Active\n## Done\n- [x] **~~a~~** - completed:2026-11-04\n");
    main(["reopen", path, "3"], CLOCK);
    expect(readFileSync(path, "utf8")).toBe("## Active\n- [ ] **a**\n## Done\n");
    main(["trash", path, "2"], CLOCK);
    expect(readFileSync(path, "utf8")).toBe(
      "## Active\n## Done\n- [x] **~~a~~** - @status:trash completed:2026-11-04\n",
    );
  });

  it("should trash, reopen and skip in a Core file", () => {
    const path = file("a.md", "- [ ] a @every:1d due:2026-11-04\n");
    main(["skip", path, "1"], CLOCK);
    expect(readFileSync(path, "utf8")).toContain("due:2026-11-05");
    main(["trash", path, "1"], CLOCK);
    expect(readFileSync(path, "utf8")).toContain("@status:trash");
    main(["reopen", path, "1"], CLOCK);
    expect(readFileSync(path, "utf8")).not.toContain("@status:trash");
  });

  it("should clock in and out, using the local time", () => {
    const path = file("a.md", "- [ ] a\n");
    main(["clock-in", path, "1"], CLOCK);
    expect(readFileSync(path, "utf8")).toContain("clock:2026-11-04T09:05/");
    main(["clock-out", path, "1", "--now", "2026-11-04T10:00"], CLOCK);
    expect(readFileSync(path, "utf8")).toContain("clock:2026-11-04T09:05/10:00");
  });

  it("should need a real line number", () => {
    expect(() => main(["complete", file("a.md", ""), "x"], CLOCK)).toThrow("not a line number");
  });

  it("should need a line argument", () => {
    expect(() => main(["complete", file("a.md", "")], CLOCK)).toThrow("missing <line>");
  });
});

describe("add", () => {
  it("should add to a section", () => {
    const path = file("a.md", "## A\n\n## B\n");
    main(["add", path, "New", "--section", "A", "--token", "due:2026-11-04"], CLOCK);
    expect(readFileSync(path, "utf8")).toBe("## A\n- [ ] New due:2026-11-04\n\n## B\n");
  });

  it("should add without tokens", () => {
    const path = file("a.md", "- [ ] x\n");
    main(["add", path, "New"], CLOCK);
    expect(readFileSync(path, "utf8")).toBe("- [ ] x\n- [ ] New\n");
  });
});

describe("regenerate", () => {
  const AGENDA = "<!-- orgdown:view list -->\n<!-- /orgdown:view -->\n";

  it("should report a stale file with --check, without changing it", () => {
    file("t.md", "- [ ] a\n");
    const path = file("agenda.md", AGENDA);
    expect(main(["regenerate", path, "--check"], CLOCK)).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(AGENDA);
  });

  it("should regenerate, and then pass --check", () => {
    file("t.md", "- [ ] a\n");
    const path = file("agenda.md", AGENDA);
    expect(main(["regenerate", path], CLOCK)).toBe(0);
    expect(readFileSync(path, "utf8")).toContain("- a ([t.md:1](t.md))");
    expect(main(["regenerate", path, "--check"], CLOCK)).toBe(0);
  });
});

describe("TASKS.md commands", () => {
  it("should fix a file", () => {
    const path = file("TASKS.md", "## Active\n- [ ] Plain @priority:1\n");
    main(["fix", path], CLOCK);
    expect(readFileSync(path, "utf8")).toBe("## Active\n- [ ] **Plain** - @priority:1\n");
  });

  it("should convert to Core", () => {
    main(["convert", file("TASKS.md", "## Active\n- [ ] **a**\n"), "--to", "core"], CLOCK);
    expect(output()).toContain("- [ ] a @status:next");
  });

  it("should convert to TASKS.md, with warnings on stderr", () => {
    main(["convert", file("a.md", "Prose\n- [ ] a\n"), "--to", "tasks-md"], CLOCK);
    expect(output()).toContain("## Active");
    expect(errors.join("")).toContain("Prose");
  });

  it("should refuse an unknown format", () => {
    expect(() => main(["convert", file("a.md", ""), "--to", "org"], CLOCK)).toThrow("--to must be");
  });
});

describe("the plugin hook", () => {
  const hook = (input: string): number => main(["hook"], CLOCK, () => input);

  it("should exit 2 with the problems for a broken TASKS.md", () => {
    const path = file("TASKS.md", "## Active\nprose\n");
    expect(hook(JSON.stringify({ tool_input: { file_path: path } }))).toBe(2);
    expect(errors.join("")).toContain("OD602");
  });

  it("should pass a clean TASKS.md", () => {
    const path = file("TASKS.md", "## Active\n- [ ] **a**\n");
    expect(hook(JSON.stringify({ tool_input: { file_path: path } }))).toBe(0);
  });

  it("should ignore warnings", () => {
    const path = file("tasks.v2.md", "- [ ] a @priority:1\n");
    expect(hook(JSON.stringify({ tool_input: { file_path: path } }))).toBe(0);
  });

  it("should ignore other files", () => {
    expect(hook(JSON.stringify({ tool_input: { file_path: file("a.md", "x") } }))).toBe(0);
  });

  it("should ignore a missing file", () => {
    expect(hook(JSON.stringify({ tool_input: { file_path: join(folder, "TASKS.md") } }))).toBe(0);
  });

  it("should never fail on input it cannot read", () => {
    expect(hook("not json")).toBe(0);
    expect(hook("{}")).toBe(0);
  });
});

describe("unknown commands", () => {
  it("should be refused", () => {
    expect(() => main(["frobnicate"], CLOCK)).toThrow("not a command");
  });
});

describe("files", () => {
  it("should refuse to overwrite a file that changed", () => {
    const path = file("a.md", "new");
    expect(() => writeIfUnchanged(path, "old", "text")).toThrow(RefusedError);
    expect(readFileSync(path, "utf8")).toBe("new");
  });

  it("should list Markdown only, skipping hidden folders", () => {
    file("a.md", "x");
    file("b.txt", "x");
    mkdirSync(join(folder, ".git"));
    file(".git/c.md", "x");
    expect(markdownFiles(folder).map(({ path }) => path)).toEqual(["a.md"]);
  });
});
