---
name: orgdown-format
description: Use when reading, writing or editing OrgDown task lines in any Markdown file, such as lines with tokens like `@status:next`, `due:2026-11-07` or `@every:1w`, or when the user asks for Org mode features in Markdown (TODO states, priorities, SCHEDULED, DEADLINE, repeaters, clocking). Explains the line format and how to change tasks safely. For a file named TASKS.md, use orgdown-tasks-md as well.
---

# OrgDown task lines

OrgDown is Org mode's task model in plain Markdown. A task is a GFM checkbox with a title, then a
run of tokens at the very end of the line.

```markdown
- [ ] Ship the reader #work @status:next @context:computer due:2026-11-14 @priority:1
```

Run the tool with `node "${CLAUDE_PLUGIN_ROOT}/bin/orgdown.mjs"`. Below it's written as `orgdown`.

## Change tasks with the tool

Don't edit these by hand. Repeating tasks and `completed:` dates are easy to get wrong, and the
tool keeps every other byte of the file. Find the line number first, and pass `--expect` with part
of the title, so an edit can't land on the wrong line if the file has moved.

```bash
orgdown complete <file> <line> --expect "Water"
orgdown reopen <file> <line> --expect "Water"
orgdown trash <file> <line> --expect "Water"
orgdown skip <file> <line> --expect "Water"
orgdown add <file> "Title #tag" --section "Garden" --token due:2026-11-14 --token @status:next
orgdown archive <file> <line> --expect "Water"
orgdown validate <file>
```

Completing a repeating task finishes this occurrence and creates the next one. Never do that by
hand. If `orgdown` isn't available, read `references/line-format.md` in this skill first.

## The format

**Tokens must come last.** Anything after a token, even `#tag`, turns the whole line into title
text. Put tags and prose before the tokens.

| Org                  | OrgDown                                   |
| -------------------- | ----------------------------------------- |
| `TODO`               | `- [ ]` (this is the `inbox` state)       |
| `NEXT`               | `@status:next`                            |
| `STARTED`            | `@status:in-progress`                     |
| `WAITING`            | `@status:waiting @waiting:"who or what"`  |
| `HOLD`               | `@status:blocked`                         |
| `SOMEDAY`            | `@status:someday`                         |
| `DONE`               | `- [x]`, with `completed:YYYY-MM-DD`      |
| `CANCELLED`          | `- [x]` with `@status:trash`              |
| `[#A]` `[#B]` `[#C]` | `@priority:1` `@priority:2` `@priority:3` |
| `DEADLINE:`          | `due:YYYY-MM-DD`, with `@due-time:14:30`  |
| Deadline warning     | `@warn:3d`                                |
| `SCHEDULED:`         | `defer:YYYY-MM-DD` (hidden until then)    |
| `<2026-11-05 14:00>` | `at:2026-11-05T14:00/15:30`               |
| `+1w`                | `@every:1w` (units: `d`, `w`, `m`)        |
| `++1w`               | `@every:1w @repeat-catch-up:yes`          |
| `.+1w`               | `@after:1w`                               |
| `+1y`                | `@every:12m`                              |
| `Effort`             | `@estimate:30m`                           |
| `:tag:`              | `#tag` in the title                       |

`@habit:yes` on a repeating task tracks a streak in the `habits` agenda view. `archive` moves a closed
top-level task to `Archive.md`.

Repeat rules can add `@repeat-on:mon,thu` (with a `w` unit), `@repeat-until:YYYY-MM-DD` and
`@repeat-count:5`. Use `@kind:project` for a task whose children work toward an outcome.

Copy the `@` exactly from this table: `@priority:1` and `due:2026-11-07` are both right, and
`priority:1` is refused.

Nest with 2 spaces. Use `- ` bullets for new tasks. Dates are `YYYY-MM-DD`: resolve "Friday" to a
date before writing it. A title must not end in a word with a colon, or a bare URL. Write
`<https://example.com>`, or a Markdown link.

## Rules

- Never invent or edit a `<!-- id:… rev:… -->` trailer.
- Keep tokens you don't recognize. They belong to another tool.
- Lines inside code fences and `orgdown:view` regions aren't tasks.
- In `tasks.v2.md`, Dopo Tasks owns the file. Don't add `@priority:`, `@every:` or the other
  planning tokens, and don't complete repeating tasks with the tool. Only edit titles, checkboxes
  and Core tokens, and add new lines without a trailer. `orgdown validate` warns about the rest.
- Run `orgdown validate <file>` after a hand edit, and fix what it reports. Its codes are stable, and
  each message says what's wrong.
