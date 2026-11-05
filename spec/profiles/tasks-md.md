# The `TASKS.md` profile

Claude's productivity plugin keeps tasks in a file named `TASKS.md` in the working directory. A
browser dashboard edits the same file. This profile makes that file a first-class OrgDown source:
Claude keeps using it the way it does today, the dashboard keeps working, and every OrgDown tool
can read it. This profile applies when a file's name is exactly `TASKS.md`.

## 1. The constraint

The dashboard doesn't edit lines. It parses the file into cards and writes **the whole file** back.
Anything it doesn't model is deleted, so the format below is shaped entirely by what survives.

| In the file                             | What the dashboard does on save                  |
| --------------------------------------- | ------------------------------------------------ |
| Prose, blank lines, front matter, `###` | Deleted                                          |
| Tasks before the first `##` section     | Deleted                                          |
| A `*` or `+` task, or `[X]`             | Deleted, or changed to `[x]`                     |
| A non-task sub-bullet                   | Deleted                                          |
| A subtask at any depth                  | Flattened to one level under its task            |
| `- [ ] Plain text @status:next`         | Rewritten as `- [ ] **Plain text @status:next**` |
| `- [ ] **Title** @status:next`          | Rewritten as `- [ ] **Title** - @status:next`    |
| `- [ ] **Title** - note @status:next`   | Kept                                             |
| A card dragged to another section       | The line moves. Its tokens don't change          |

Only one shape carries tokens safely: a bold title, a dash with a space on each side, and then the
note and tokens. That shape is **the** line format of this profile.

## 2. File shape

```markdown
# Tasks

## Active

- [ ] **Send the deck** - for Priya @priority:1 due:2026-11-07
  - [ ] Add the Q3 numbers

## Waiting On

- [ ] **Budget sign-off** - from finance, since 2026-11-01 @waiting:"finance sign-off"

## Someday

- [ ] **Learn the cello**

## Done

- [x] **~~Book the venue~~** - completed:2026-11-02
```

The template sections are `Active`, `Waiting On`, `Someday` and `Done`. Other `##` sections are
allowed. The blank line after a heading in this example goes away on the first dashboard save,
and that's harmless.

## 3. Reading a line

Lines are found by [Core](../01-core.md), and then:

1. If the core title has the form `**<inner>**<rest>`, with the shortest possible `<inner>`, then
   `title` is `<inner>` with one surrounding `~~` pair removed. `note` is `<rest>`, trimmed, without
   a leading dash and any spaces after it, so a `<rest>` of a lone dash is an empty note. This is how
   the dashboard itself splits a line. Any other title is left as it is, with an empty note.
2. The plugin's own form of a finished task is `~~Task~~ (2026-11-02)`. It reads the same plain or
   inside bold. The title is `Task`, and if the line has no `completed:`, the date becomes
   `completed`. Only `YYYY-MM-DD` dates are read.
3. Tags are read from the title and note together.

## 4. Sections set the state

The dashboard moves a card without touching its tokens, so a section outranks `@status:`. Only a
level 2 heading sets the section, and `**` around its text is ignored.

| Section (ignoring case) | State      | `@status:` values that may refine it   |
| ----------------------- | ---------- | -------------------------------------- |
| `Active`                | `next`     | `inbox` `next` `in-progress` `blocked` |
| `Waiting On`            | `waiting`  | `waiting`                              |
| `Someday`               | `someday`  | `someday`                              |
| `Done`                  | `done`     | `done` `trash`                         |
| Any other               | Core rules | Any                                    |

In a named section, the state is the `@status:` value if it's listed for that section. Otherwise
it's the section's state, and the file gets [OD604](../07-diagnostics.md). Two exceptions:

- `[x]` means `done` in every section, whatever `@status:` says, because the dashboard checks a box
  without touching tokens. The one exception is `@status:trash` in `Done`, which stays `trash`.
- `[ ]` in `Done` stays `done`, with [OD605](../07-diagnostics.md).

**Waiting reason.** In `Waiting On`, the reason is `@waiting:`, then the note, then `unspecified`.

**`@status:waiting` with no reason** counts as no status at all outside `Waiting On`, as in Core.

**Subtasks.** Any explicit `@status:` applies. Otherwise `[x]` is `done`, and `[ ]` takes the
section's state, except in `Done`, where it's `next`, so an open subtask of a finished task stays
open.

## 5. Writing

Writers use this format, and preserve bytes as usual. Where they're writing a new line, or
changing one, they MUST produce the form in §2.

- **Add:** `- [ ] **Title** - <note> <tokens>` at the end of the section. With no note, write
  `- [ ] **Title** - <tokens>`, and with no tokens either, `- [ ] **Title**`. `add` defaults to the
  `Active` section, and a missing section is added at the end of the file. The written line must read
  back with the same note and tokens, as in Core, so a note ending in token-shaped words is refused. After any write, a line never ends in
  a lone dash, and a bold title with tokens always has its dash.
- **Complete:** rewrite a top-level line in the §2 form, run
  [`complete`](../04-operations.md#2-completing) with Core's reading of the document, wrap the inner title in `~~`, and move the line and its subtasks after the last non-blank line of
  `Done`. A next occurrence stays where the task was. With no `Done` section, the task stays where
  it is. A subtask is completed where it stands, and it isn't struck through. Open subtasks of a
  completed task stay open.
- **Reopen:** run [`reopen`](../04-operations.md#4-reopening), remove the `~~`, and move the line
  after the last non-blank line of `Active`. With no `Active` section, one is added at the end of the file, because an
  unchecked line in `Done` would still read as done.
- **Status changes** are moves between sections. A writer adds `@status:` only for a refinement
  that the section can't express, such as `@status:blocked` in `Active`.
- **Dates** are tokens: `due:2026-11-07`, not `due Friday`. Resolve words like Friday to a date
  before writing. Prose such as "for Priya" stays in the note.
- **Notes** go in the note text. Never add a non-task sub-bullet: the dashboard deletes them.

Any line a write here produces has one space after the checkbox. A top-level line it rewrites also
has single spaces between its note, tokens and any trailer, even with an empty title. A section a
write moves a task to is a real section line, so a heading inside a fence doesn't count.

Files written by the plugin's own instructions keep working. They read correctly, and validators
report what would be fragile.

## 6. Fixing

A `fix` operation upgrades a file to the form in §2 without changing what it means. It is
idempotent, and it only changes tasks and their note bullets:

- At any depth, `*` and `+` markers become `-`, and `[X]` becomes `[x]`.
- A top-level task loses any leading whitespace, because the dashboard reads an indented line as a
  subtask.
- On a top-level task, a title that isn't bold is wrapped: `- [ ] **Title** - <tokens>`. An empty
  title isn't wrapped, here or in any other write, and an empty title isn't struck through. It
  has no note either, so bullets under it stay where they are.
- On a top-level task, a bold title with tokens gets its dash.
- `~~Task~~ (2026-11-02)` becomes `**~~Task~~** - completed:2026-11-02`.
- A non-task list item in a top-level task's body, indented exactly one level, is folded into the
  note, joined with `; `, and removed. The note keeps its place before the tokens. More deeply
  indented bullets stay, for the validator to report.

Prose and sub-headings are left for the author, because moving them is a judgment call.

## 7. Conversion

A converter maps this profile to any Core file, and back.

**To Core.** Each task becomes a Core line with an explicit state. A task keeps its title without
bold or strikethrough, and the note, if any, is appended to the title after a dash. Sections stay
as they are, and other lines pass through. The marker becomes `-`. A closed state is `[x]`, even
from a `[ ]` line in `Done`. The state is written as `@status:` when the checkbox can't express it,
`@waiting:` is written for every waiting task, and a date from the plugin's done form becomes
`completed:`. Tokens are in canonical order.

**From Core.** Each root task goes to the section for its state, with its whole subtree. `inbox`, `next`, `in-progress` and
`blocked` go to `Active`, `waiting` to `Waiting On`, `someday` to `Someday`, and `done` and `trash`
to `Done`, keeping input order. Root tasks keep a `@status:` only in `Active`, if it isn't `next`,
and in `Done`, if it's `trash`.
A subtask keeps `@status:` unless it would read back the same in that section, or it's `inbox` in
`Active`, which reads back as `next`. An empty title isn't wrapped. Tasks deeper than one level
are flattened to one level, each under its root task, with one warning per root. A task's body is
dropped, with one warning per task. Each other non-blank line is dropped, with one warning, except
`# Tasks` and the template section headings. Files keep a task line's `\r`, as in Core. The output is `# Tasks`, then the four template
sections in template order, each block separated by a blank line, with a final newline.

Identity isn't carried across. A trailer `id` is not valid on a `TASKS.md` line, because the
dashboard's title parser would keep it but no tool could reconcile it.
