// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { validate } from "../src/diagnostics.js";
import { completeTasksMd, fix, fromCore, parseTasksMd, reopenTasksMd } from "../src/tasks-md.js";

/**
 * What the productivity plugin's dashboard does on save, written from its documented behavior: it
 * models sections, tasks and one level of subtasks, and rewrites the whole file from that model.
 * `spec/profiles/tasks-md.md` §1 is the contract this stands for.
 */
const dashboardSave = (markdown: string): string => {
  interface Card {
    checked: boolean;
    title: string;
    note: string;
    subtasks: string[];
  }
  const sections: { name: string; cards: Card[] }[] = [];
  for (const line of markdown.split("\n")) {
    const heading = /^## \*{0,2}(.+?)\*{0,2}$/.exec(line);
    const current = sections.at(-1);
    if (heading !== null) sections.push({ name: (heading[1] as string).trim(), cards: [] });
    else if (current !== undefined && /^- \[[ xX]\]/.test(line)) {
      const text = line.replace(/^- \[[ xX]\]\s*/, "");
      const bold = /^\*\*(.+?)\*\*(.*)$/.exec(text);
      current.cards.push({
        checked: /\[[xX]\]/.test(line),
        title: bold === null ? text : (bold[1] as string),
        note: bold === null ? "" : (bold[2] as string).replace(/^\s*-\s*/, "").trim(),
        subtasks: [],
      });
    } else if (/^\s+- \[[ xX]\]/.test(line)) {
      const box = /\[[xX]\]/.test(line) ? "[x]" : "[ ]";
      current?.cards.at(-1)?.subtasks.push(`  - ${box} ${line.replace(/^\s+- \[[ xX]\]\s*/, "")}`);
    }
  }
  const body = sections.map(({ name, cards }) => {
    const rows = cards.flatMap(({ checked, title, note, subtasks }) => [
      `- ${checked ? "[x]" : "[ ]"} **${title}**${note === "" ? "" : ` - ${note}`}`,
      ...subtasks,
    ]);
    return [`\n## ${name}`, ...rows].join("\n");
  });
  return `# Tasks\n${body.join("\n")}\n`;
};

const FIELDS = [
  "title",
  "note",
  "state",
  "due",
  "priority",
  "completed",
  "waitingReason",
  "tags",
  "recurrence",
  "depth",
] as const;

const meaning = (markdown: string): unknown =>
  parseTasksMd(markdown).tasks.map((task) => Object.fromEntries(FIELDS.map((field) => [field, task[field]])));

const BOARD = `# Tasks

## Active

- [ ] **Send the deck** - for Priya @priority:1 due:2026-11-07
  - [ ] Add the numbers
  - [x] Pick the template
- [ ] **Water #home** - @every:1w due:2026-11-04
- [ ] **Plain**
- [ ] **Blocked one** - @status:blocked @context:"Home Office"

## Waiting On

- [ ] **Budget sign-off** - from finance, since 2026-11-01
- [ ] **Quote** - @waiting:"the plumber"

## Someday

- [ ] **Learn the cello**

## Done

- [x] **~~Book the venue~~** - completed:2026-11-02
- [x] **~~Binned~~** - @status:trash

## Ideas

- [ ] **Unmapped section** - @status:someday
`;

describe("a board in the profile form", () => {
  it("should mean the same after a dashboard save", () => {
    expect(meaning(dashboardSave(BOARD))).toEqual(meaning(BOARD));
  });

  it("should be stable across repeated saves", () => {
    const once = dashboardSave(BOARD);
    expect(dashboardSave(once)).toBe(once);
  });

  it("should have no dashboard problems", () => {
    expect(validate(BOARD, "TASKS.md")).toEqual([]);
  });

  it("should survive completing every top-level task", () => {
    for (const task of parseTasksMd(BOARD).tasks.filter(({ depth, checked }) => depth === 0 && !checked)) {
      const done = completeTasksMd(BOARD, task.line, "2026-11-04");
      expect(meaning(dashboardSave(done))).toEqual(meaning(done));
      expect(validate(done, "TASKS.md").filter(({ code }) => /OD60[123]/.test(code))).toEqual([]);
    }
  });

  it("should survive reopening", () => {
    const line = (parseTasksMd(BOARD).tasks.find(({ title }) => title === "Book the venue") as { line: number }).line;
    const reopened = reopenTasksMd(BOARD, line);
    expect(meaning(dashboardSave(reopened))).toEqual(meaning(reopened));
  });
});

describe("a file written the plugin way", () => {
  const PLUGIN = `# Tasks

## Active
- [ ] **Review the proposal** - for Sarah
  - Has two appendices
- [ ] Plain task @priority:1 due:2026-11-07

## Done
- [x] ~~Book the venue~~ (2026-11-02)
`;

  it("should lose data in a dashboard save when left alone", () => {
    const saved = dashboardSave(PLUGIN);
    expect(saved).not.toContain("Has two appendices");
    expect(saved).toContain("**Plain task @priority:1 due:2026-11-07**");
  });

  it("should be reported by the validator", () => {
    expect(validate(PLUGIN, "TASKS.md").map(({ code }) => code)).toEqual(["OD602", "OD601"]);
  });

  it("should survive once fixed", () => {
    const fixed = fix(PLUGIN);
    expect(fix(fixed)).toBe(fixed);
    expect(meaning(dashboardSave(fixed))).toEqual(meaning(fixed));
    expect(dashboardSave(fixed)).toContain("Has two appendices");
  });
});

describe("a board converted from Core", () => {
  it("should survive a dashboard save", () => {
    const { text } = fromCore(
      '- [ ] A #x @status:next due:2026-11-07\n  - [ ] sub\n- [ ] B @status:waiting @waiting:"Sam"\n',
    );
    expect(meaning(dashboardSave(text))).toEqual(meaning(text));
  });
});
