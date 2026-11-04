# Core

## 1. Documents and lines

A document is UTF-8 text split on `\n`. A trailing `\r` on a line is ignored for parsing and
kept when the line is written back. Every line is exactly one of these kinds, tested in order:

1. **Opaque** lines, which are never interpreted:
   - YAML front matter: from a `---` on the first line through the next line that is `---`.
   - Fenced code: from a line matching `^\s*(`{3,}|~{3,})` through the next line that starts,
     after optional whitespace, with at least as many of the same character and nothing else
     but whitespace. An unclosed fence runs to the end of the document.
   - HTML comment blocks: a line that starts, after optional whitespace, with `<!--` and has no
     `-->` on it, through the next line containing `-->`.
   - Generated regions: from an `<!-- orgdown:view … -->` line through the next
     `<!-- /orgdown:view -->` line ([Agenda §6](06-agenda.md#6-agenda-md-files)).
2. **Task** lines, matching
   `^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$`.
   Ordered list items (`1. [ ] x`) are not tasks, and neither is `- [ ]` with nothing after the
   closing bracket's whitespace requirement, such as a line ending at `]`.
3. **Section** lines, matching `^#{2,6}\s+\S`. A level-one heading is not a section.
4. **Passthrough** lines: everything else.

A reader MUST NOT drop or change any line it doesn't write to.

## 2. Nesting

A task's **depth** is its indentation divided by 2, rounded down, with a tab counted as 2
columns. Its **parent** is the nearest task above it with a smaller depth. A section line ends
the scope, so the first task after a section is a root. Opaque and passthrough lines do not end
the scope. A task's subtree is the run of following tasks with a greater depth, ending at the
first task of equal or lesser depth, or at a section.

## 3. The parts of a task line

The text after the checkbox has three parts, read from the right:

```text
- [ ] Ship the feed reader #work  @status:next due:2026-11-14  <!-- id:a1 rev:r7 -->
      └──── title ──────────────┘ └──── token run ──────────┘  └──── trailer ─────┘
```

### 3.1 Trailer

If the text ends with an HTML comment (`\s*<!--\s*(.*?)\s*-->\s*$`), that comment is the
trailer. Within it, whitespace-separated `id:<value>` and `rev:<value>` set the task's `id` and
`rev`. Only the application that owns a file mints these values
([profile](profiles/tasks-v2.md)). A task without an `id` is simply a task with no identity.

### 3.2 Token run

Split what remains into words on whitespace. A word **opens a token** if it matches
`(?i)^@?[a-z][a-z-]*:`. Then repeat, starting with `end` at the last word:

1. Let `start` be the nearest word at or before `end` that opens a token. If there is none,
   stop.
2. Let `token` be the words from `start` through `end`, joined with single spaces.
3. If `start` equals `end`, or the part of `token` after its first `:` is at least two
   characters long and both starts and ends with `"`, then `token` is a token. Add it to the
   front of the run and continue from the word before `start`.
4. Otherwise stop.

So **tokens come last**. In `Buy milk @context:errands #home`, the word `#home` stops the scan,
and the whole line is title. Tags and prose go before the tokens.

The title is the words before the run, joined with single spaces.

> A URL at the end of a line opens a token, because `https:` matches. In `- [ ] Read https://example.com/a`,
> the URL is an unknown token, kept but not part of the title. Write `<https://example.com/a>`
> or a Markdown link. Validators report this as [OD105](07-diagnostics.md).

### 3.3 Tags

A tag is a word in the title matching `^#[\p{L}][\p{L}\p{N}_/-]*$`, with no surrounding
punctuation. Tags stay in the title text. They are exposed as `tags`, without the `#`, in order
of first appearance. Words inside an inline code span are not tags.

## 4. Core tokens

Keys are case-sensitive: `@Status:next` opens a token, but it is unknown.

| Token       | Value                                                                     | Field           |
| ----------- | ------------------------------------------------------------------------- | --------------- |
| `@status:`  | `inbox` `next` `in-progress` `blocked` `waiting` `someday` `done` `trash` | `state`         |
| `@context:` | a name, quoted if it contains whitespace                                  | `context`       |
| `@project:` | a name; read only, for older files                                        | `project`       |
| `@kind:`    | `project` or `single-action`                                              | `nodeKind`      |
| `@energy:`  | `low` `medium` `high`                                                     | `energy`        |
| `@waiting:` | a reason, quoted if it contains whitespace; must not be blank             | `waitingReason` |
| `due:`      | `YYYY-MM-DD`                                                              | `due`           |
| `defer:`    | `YYYY-MM-DD`                                                              | `defer`         |

A `@context:` or `@waiting:` value that is a complete `"…"` string has its quotes removed.

`@kind:project` marks a task as a project: an outcome its children work toward.
`@kind:single-action` marks a list of unrelated tasks. A plain task has no `nodeKind`.

[Planning](02-planning.md) and [Recurrence](03-recurrence.md) define further tokens. Keys that
start with `@x-` are reserved for private extensions, and no OrgDown version will define one.

## 5. Reading rules

- **Unknown and invalid tokens** are kept in `extraTokens`, verbatim and in order. This includes
  a known key with a value that fails its grammar, such as `@status:frozen` or `due:2026-13-40`.
- **Duplicates.** If a key appears more than once with valid values, the last one wins. The
  earlier ones are neither fields nor extras. An invalid duplicate is an extra, and does not
  displace a valid token.
- **State.** An explicit `@status:` wins over the checkbox. Without one, `[ ]` is `inbox`, and
  `[x]` or `[X]` is `done`.
- **Waiting needs a reason.** If the state would be `waiting` and there is no valid `@waiting:`,
  the state falls back to the checkbox default, and `@status:waiting` is added to the end of
  `extraTokens`.
- A reader MUST NOT fail on any input. Bad input degrades to title text, extras or passthrough.

## 6. State meanings

| State         | Meaning                                                 | Checkbox | Org keyword |
| ------------- | ------------------------------------------------------- | -------- | ----------- |
| `inbox`       | Captured, not yet decided                               | `[ ]`    | `TODO`      |
| `next`        | The next thing to do                                    | `[ ]`    | `NEXT`      |
| `in-progress` | Being worked on                                         | `[ ]`    | `STARTED`   |
| `blocked`     | Can't proceed                                           | `[ ]`    | `HOLD`      |
| `waiting`     | Someone else has it                                     | `[ ]`    | `WAITING`   |
| `someday`     | Maybe later                                             | `[ ]`    | `SOMEDAY`   |
| `done`        | Finished                                                | `[x]`    | `DONE`      |
| `trash`       | Abandoned                                               | `[x]`    | `CANCELLED` |

`done` and `trash` are the **closed** states. All others are **open**. A task that doesn't match
this table, such as `- [ ] x @status:done`, is still read by the rules above, so its state is
`done`, and validators report it as [OD108](07-diagnostics.md).

## 7. Canonical form

The canonical form of a task line is:

```text
<indent>- [ |x] <title> <tokens> <!-- id:… rev:… -->
```

with 2 spaces of indent per depth, one space between parts, and tokens in this order. `@status:`
is written only when the checkbox can't express the state.

`@status:` `@context:` `@energy:` `@waiting:` `due:` `defer:` `@due-time:` `@warn:` `at:`
`@remind:` `@estimate:` `@priority:` `@today:` `@every:`/`@after:` `@repeat-on:` `@repeat-until:`
`@repeat-count:` `@repeat-catch-up:` `completed:` _extras_ `@kind:`

Every token after `defer:` comes before `@kind:` because older Dopo Tasks builds keep those
tokens as extras, which they write in exactly that position. So the canonical form is stable
across those builds.

`@context:` and `@waiting:` values are quoted when they contain whitespace. `@waiting:` is
always quoted, as the existing dialect writes it.
