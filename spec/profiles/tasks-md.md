# The `TASKS.md` profile

Claude's productivity plugin keeps tasks in a file named `TASKS.md` in the working directory. A
browser dashboard edits the same file. This profile makes that file a first-class OrgDown source:
Claude keeps using it the way it does today, the dashboard keeps working, and every OrgDown tool
can read it. This profile applies when a file's name is exactly `TASKS.md`.

## 1. The constraint

The dashboard doesn't edit lines. It parses the file into cards and writes **the whole file** back.
Anything it doesn't model is deleted, so the format below is shaped entirely by what survives.

| In the file                                  | What the dashboard does on save                       |
| -------------------------------------------- | ----------------------------------------------------- |
| Prose, blank lines, front matter, `###`      | Deleted                                               |
| Tasks before the first `##` section          | Deleted                                               |
| A `*` or `+` task, or `[X]`                  | Deleted, or changed to `[x]`                          |
| A non-task sub-bullet                        | Deleted                                               |
| A subtask at any depth                       | Flattened to one level under its task                 |
| `- [ ] Plain text @status:next`              | Rewritten as `- [ ] **Plain text @status:next**`      |
| `- [ ] **Title** @status:next`               | Rewritten as `- [ ] **Title** - @status:next`         |
| `- [ ] **Title** - note @status:next`        | Kept                                                  |
| A card dragged to another section            | The line moves. Its tokens don't change               |

Only one shape carries tokens safely: a bold title, then ` - `, then the note and tokens. That
shape is **the** line format of this profile.

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

1. The core title has the form `**<inner>**`, or `**<inner>** - <note>`, or `**<inner>** -`.
   `title` is `<inner>` with one surrounding `~~` pair removed. `note` is `<note>`, or empty.
   A title not in that form is left as it is, and reported as [OD601](../07-diagnostics.md).
2. The plugin's own form of a finished task is `~~Task~~ (2026-11-02)`. It reads the same plain or
   inside bold. The title is `Task`, and if the line has no `completed:`, the date becomes
   `completed`. Only `YYYY-MM-DD` dates are read.
3. Tags are read from the title and note together.

## 4. Sections set the state

The dashboard moves a card without touching its tokens, so a section outranks `@status:`.

| Section (ignoring case) | State      | `@status:` values that may refine it          |
| ----------------------- | ---------- | --------------------------------------------- |
| `Active`                | `next`     | `inbox` `next` `in-progress` `blocked`        |
| `Waiting On`            | `waiting`  | `waiting`                                     |
| `Someday`               | `someday`  | `someday`                                     |
| `Done`                  | `done`     | `done` `trash`                                |
| Any other               | Core rules | Any                                           |

In a named section, the state is the `@status:` value if it's listed for that section. Otherwise
it's the section's state, and the file gets [OD604](../07-diagnostics.md). Two exceptions:

- `[x]` means `done` in every section except where `@status:trash` is valid, because the dashboard
  checks a box without moving the card.
- `[ ]` in `Done` stays `done`, with [OD605](../07-diagnostics.md).

**Waiting reason.** In `Waiting On`, the reason is `@waiting:`, then the note, then `unspecified`.
Subtasks take their section's state only if they don't have their own checkbox state: `[x]` is
`done`, and a subtask's explicit `@status:` applies.

## 5. Writing

Writers use this format, and preserve bytes as usual. Where they're writing a new line, or
changing one, they MUST produce the form in §2.

- **Add:** `- [ ] **Title** - <note> <tokens>` at the end of the section. With no note, write
  `- [ ] **Title** - <tokens>`, and with no tokens either, `- [ ] **Title**`. A line never ends
  in a bare ` -`, and a bold title with tokens always has the ` - `.
- **Complete:** run [`complete`](../04-operations.md#2-completing), wrap the inner title in `~~`,
  and move the line to the end of `Done`, along with its subtasks. A next occurrence goes to the
  end of the section the task came from.
- **Reopen:** run [`reopen`](../04-operations.md#4-reopening), remove the `~~`, and move the line
  to `Active`.
- **Status changes** are moves between sections. A writer adds `@status:` only for a refinement
  that the section can't express, such as `@status:blocked` in `Active`.
- **Dates** are tokens: `due:2026-11-07`, not `due Friday`. Resolve words like Friday to a date
  before writing. Prose such as "for Priya" stays in the note.
- **Notes** go in the note text. Never add a non-task sub-bullet: the dashboard deletes them.

Files written by the plugin's own instructions keep working. They read correctly, and validators
report what would be fragile.

## 6. Fixing

A `fix` operation upgrades a file to the form in §2 without changing what it means. It is
idempotent, and it only changes tasks and their note bullets:

- Top-level `*` and `+` markers become `-`, and `[X]` becomes `[x]`, on tasks at any depth.
- A title that isn't bold is wrapped: `- [ ] **Title** - <tokens>`.
- A bold title with tokens gets its ` - `.
- `~~Task~~ (2026-11-02)` becomes `**~~Task~~** - completed:2026-11-02`.
- A non-task list item directly under a task is folded into the note, joined with `; `, and
  removed. The note keeps its place before the tokens.

Prose and sub-headings are left for the author, because moving them is a judgment call.

## 7. Conversion

A converter maps this profile to any Core file, and back.

**To Core.** Each task becomes a Core line with an explicit state. A task keeps its title without
bold or strikethrough. The note, if any, is appended to the title after ` - `. Sections become `##`
sections. The state is written as `@status:` when the checkbox can't express it. In `Waiting On`,
`@waiting:` is always written.

**From Core.** Each task goes to the section for its state. `inbox`, `next`, `in-progress` and
`blocked` go to `Active`, `waiting` to `Waiting On`, `someday` to `Someday`, and `done` and `trash`
to `Done`, keeping input order. Only `Active` keeps a `@status:`, and only if it isn't `next`.
Subtasks keep only a `@status:` the checkbox and section can't imply. Tasks deeper than one level
are flattened to one level, each under its root task, with one warning per root. A task's body is
dropped, with one warning per task. Each non-blank passthrough line or section is dropped, with one
warning. The output always has the four template sections, in template order.

Identity isn't carried across. A trailer `id` is not valid on a `TASKS.md` line, because the
dashboard's title parser would keep it but no tool could reconcile it.
