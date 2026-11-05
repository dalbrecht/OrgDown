# Agenda

An agenda is a view computed across files. The inputs are an ordered list of documents, `today`,
and a view. The output is deterministic: the same inputs give the same bytes.

## 1. Live tasks

A view considers tasks in input order: documents in the given order, lines in document order.
Tasks inside generated regions don't exist, so an Agenda MD file can't feed itself.

A task is **open** if its state is open. It is **deferred** if `defer` is after `today`.

## 2. Query language

A query is a space-separated list of terms, all of which must hold. `-` before a term negates it.
Values with spaces are double-quoted. An empty query matches every task.

| Term                                        | Holds when                                                    |
| ------------------------------------------- | ------------------------------------------------------------- |
| `open`                                      | The task is open                                              |
| `closed`                                    | The task is closed                                            |
| `status:a,b`                                | The state is one of those listed                              |
| `tag:x`                                     | The task has tag `x`, or a tag under it (`x/y`). Case matters |
| `context:x`                                 | The context is `x`, ignoring case                             |
| `energy:low`                                | The energy is that level                                      |
| `kind:project`                              | `nodeKind` is that value. `kind:none` means a plain task      |
| `deferred`                                  | The task is deferred                                          |
| `repeats`                                   | The task has a recurrence rule                                |
| `priority`                                  | The task has a priority                                       |
| `priority<=n`                               | The priority is set and is at most `n`                        |
| `due`                                       | The task has a due date                                       |
| `due<=D` `due>=D` `due=D`                   | Compares the due date. A task with none doesn't match         |
| `defer<=D` `defer>=D` `defer=D`             | Compares the defer date, likewise                             |
| `completed>=D` `completed<=D` `completed=D` | Compares the completion date, likewise                        |
| `title:"text"`                              | The title contains the text, ignoring case                    |
| `file:"glob"`                               | The document path matches the glob                            |

In a glob, `**/` matches zero or more folders, `**` matches anything, and `*` and `?` match within
one path segment. Matching is case-sensitive, and covers the whole path.

A closed task's priority still counts for `priority` terms. The only comparison on priority is
`<=`, and date comparisons are the three listed.

A date `D` is a `YYYY-MM-DD` day, `today`, or `today+Nd` / `today-Nd`.

A query that doesn't parse is an error, and so is an unknown state, energy level or kind. It never
silently matches nothing.

## 3. The day view

The `day` view is Org's daily agenda and Dopo Tasks' Today. A task is **on the day** when it is
open and any of these holds:

- it has a due date, and `due − warnDays ≤ today`, with `warnDays` defaulting to 1, even if it's
  deferred;
- it has a defer date, and `defer ≤ today`;
- `today` (the `@today:` marker) equals the view's day;
- it has a priority.

Appointments are listed separately: any open task whose `at` covers the view's day.

Rows go into the first group that applies, and each task appears once:

1. **Schedule**: appointments on that day, by start time, with all-day entries first. An entry
   spanning several days is timed on its first day and all-day on the others.
2. **High priority**: tasks with a priority, by rank, then input order. At most 5 appear. The rest
   go on to the groups below, or if no other rule puts them there, to Today.
3. **Overdue**: `due < today`, oldest first.
4. **Due**: `due = today`, then tasks due later that are inside their warning period, by due date.
5. **Today**: everything else on the day, in input order.

## 4. Other views

| View      | Shows                                                                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `week`    | `days` consecutive days from `start`, default 7 from `today`. Open tasks only. For each day with any rows: appointments in Schedule order, then tasks due, then tasks arriving (`defer` on that day), in input order. A task with both dates appears on each day |
| `list`    | Every task matching `match`, in input order, or `sort` if given                                                                                                                                                                                                  |
| `next`    | `status:next -deferred`, grouped by context ignoring case, sorted by lowercase name and shown as first written, with no context last                                                                                                                             |
| `waiting` | `status:waiting`, by due date, undated tasks last, showing the reason                                                                                                                                                                                            |
| `stuck`   | Open `@kind:project` tasks with no open descendant in state `next` or `in-progress`                                                                                                                                                                              |
| `logbook` | Closed tasks with `completed` in the range `from` to `to`, newest first, then input order                                                                                                                                                                        |
| `clock`   | For each task, the minutes of its closed entries that start in the range `from` to `to`. Tasks with none are left out. Then the total                                                                                                                            |
| `habits`  | Open `@habit:yes` tasks, with the last 14 days of completions and the streak                                                                                                                                                                                     |

`sort` is a comma-separated list of `due`, `defer`, `priority`, `title` or `file`. Tasks missing
the key sort last. Ties keep input order. `days` is 1 to 366, and anything else is an error. `match` narrows any view except `day` and `clock`, where
it's an error. Other attributes a view doesn't use are ignored. `from` and `to` take the same date
forms as queries, and default to `today-7d` and `today`.

**Habits.** A habit's history is the closed `@habit:yes` lines in the same document with the same
title. The row's graph has 14 characters, oldest first, ending today:
`x` for a day with a `completed` date, `.` for a day without one. The streak is the number of
consecutive days with a completion, counting back from today, or from yesterday if today has none
yet.

## 5. Row format

Agenda output is Markdown, and it must not create tasks. Rows are plain list items, never
checkboxes:

```text
- <title><annotations> ([<path>:<line>](<path>))
```

`<title>` is the title as written. If a row with no prefix would begin with a title like `[ ] x`, a
backslash goes before its first bracket, so the row can't read as a task: `- \\[ ] x`. `<path>` is the document's path, with spaces encoded as `%20`
in the link target, and `<line>` is the 1-based line. `<annotations>` depends on the group, each
joined with `·` after a leading `—`:

| Where                 | Annotation                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Schedule              | A prefix instead: `- 14:00 <title>`, `- 14:00–15:30 <title>` when the end is the same day, or `- <title>` all-day |
| High priority         | `#<rank>`, then the due date if there is one                                                                      |
| Overdue               | `due <date>`, `<n>d late`                                                                                         |
| Due                   | `due today`, or `due <date>`, and `<time>` if `dueTime` is set                                                    |
| `week`: due, arriving | `due`, or `arrives`, and `<time>` if due with `dueTime`                                                           |
| `waiting`             | The reason, then the due date if there is one                                                                     |
| `logbook`             | The completion date                                                                                               |
| `clock`               | `<h>h <mm>m`, with `<mm>` zero-padded                                                                             |
| `habits`              | The graph, then `streak <n>`                                                                                      |

`list`, `next`, `stuck` and Today rows have no annotations, unless a due date exists, which is
shown as `due <date>`.

A view renders as a heading plus its groups. The heading is the view's `title` or its default,
shown in the table below, at level 2. Each non-empty group has a level 3 heading. Days in `week`
are headed `### YYYY-MM-DD Ddd`, in English. An empty view is its heading, a blank line, and
`Nothing here.`

| View      | Default title     | Group headings                                     |
| --------- | ----------------- | -------------------------------------------------- |
| `day`     | `Today (<date>)`  | `Schedule` `High priority` `Overdue` `Due` `Today` |
| `week`    | `Week of <start>` | Days                                               |
| `list`    | `Tasks`           | None                                               |
| `next`    | `Next actions`    | Context names, then `No context`                   |
| `waiting` | `Waiting`         | None                                               |
| `stuck`   | `Stuck projects`  | None                                               |
| `logbook` | `Logbook`         | None                                               |
| `clock`   | `Clock`           | None. The last line is `**Total: <h>h <mm>m**`     |
| `habits`  | `Habits`          | None                                               |

Lines are separated by `\n`, with a blank line after each heading and between groups, and no
trailing blank line. In `clock`, a blank line comes before the total.

## 6. Agenda MD files

An **Agenda MD** file is a Markdown document that defines views and holds their latest output. It
stays readable anywhere, because it's just a file of headings and links.

```markdown
---
orgdown: 0.1
agenda:
  sources:
    - "Tasks/**/*.md"
    - "TASKS.md"
---

# My agenda

Anything outside the regions is yours, and it's never touched.

<!-- orgdown:view day -->
<!-- /orgdown:view -->

<!-- orgdown:view next match="-tag:work" title="Personal" -->
<!-- /orgdown:view -->
```

- **Sources** are a YAML block list of strings at `agenda.sources`, each optionally quoted, where
  `sources:` is indented under a top-level `agenda:` key. Other front matter is ignored, and no other YAML form is required. They're globs relative to the file,
  read in lexical path order within each glob. A file
  appears once, at its first match. Each source is read with the profile that fits its name. The
  Agenda MD file itself is always excluded. The default is `**/*.md`.
- **A view region** is an opening `<!-- orgdown:view <view> <attrs> -->` line and a closing
  `<!-- /orgdown:view -->` line. `attrs` are `name="value"` pairs, or `name='value'` so a
  query can hold double quotes: `title`, `match`, `sort`, `start`, `days`, `from`, `to`. An unknown view or attribute is an error, and the file isn't
  changed.
- **Regenerating** replaces only the lines between the markers, with a blank line, the view's
  output, and a blank line. Paths are relative to the Agenda MD file.
- `today` is not written to the file, except through the views that display it. A check mode MUST
  report whether regenerating would change the file, without changing it.
