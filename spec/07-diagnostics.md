# Diagnostics

A validator reports stable codes, so tools and skills can act on them. A diagnostic has `code`,
`severity`, `line` (1-based) and `message`. A validator reports one diagnostic per offending token
for OD101, OD103, OD104, OD105, OD201, OD202, OD203, OD501 and OD502, and one per line and code for
the rest. Diagnostics are sorted by line, then code, then position on the line. Severity never changes how a reader parses a file: a reader never
fails.

State in these checks is the effective state, after every reading rule, including a profile's. A
malformed value is OD101, even if the token has another problem too.

An `error` means a tool will not do what the author meant. A `warning` means a tool will, but the
file is fragile or inconsistent.

## Core and planning

| Code  | Severity | Meaning                                                                     |
| ----- | -------- | --------------------------------------------------------------------------- |
| OD101 | error    | A known key has an invalid value, so the token is ignored                   |
| OD102 | error    | A title word opens a token with a known key, so text after it ended the run |
| OD103 | warning  | A key appears twice, so the earlier value is ignored                        |
| OD104 | warning  | An unknown `@` token, which is not an `@x-` extension                       |
| OD105 | warning  | A word with no `@` and an unknown key, such as a URL, was read as a token   |
| OD106 | error    | `@status:waiting` with no reason                                            |
| OD107 | error    | `@due-time:` with no valid `due:`                                           |
| OD108 | warning  | The checkbox disagrees with `@status:`                                      |
| OD109 | warning  | `completed:` on an open line                                                |
| OD111 | warning  | `@priority:` on a closed line                                               |
| OD112 | warning  | `defer:` is after `due:`                                                    |
| OD113 | warning  | Indentation isn't a multiple of 2 columns                                   |
| OD114 | warning  | The legacy `@project:` token. Nest under an `@kind:project` task instead    |

## Recurrence

| Code  | Severity | Meaning                                                                      |
| ----- | -------- | ---------------------------------------------------------------------------- |
| OD201 | error    | A `@repeat-*` token with no valid `@every:` or `@after:`                     |
| OD202 | error    | `@repeat-on:` with a unit other than `w`                                     |
| OD203 | error    | `@repeat-catch-up:` with `@after:`                                           |
| OD204 | warning  | A repeating task with no `due:`, so it will anchor on the completion day     |
| OD205 | warning  | `@repeat-count:` and `@repeat-until:` together, so whichever ends first wins |
| OD206 | warning  | `@habit:yes` with no recurrence rule, so there's nothing to keep up with     |

## Logbook

| Code  | Severity | Meaning                                          |
| ----- | -------- | ------------------------------------------------ |
| OD301 | error    | A `clock:` entry whose end isn't after its start |
| OD302 | warning  | More than one running clock                      |

## Agenda MD

| Code  | Severity | Meaning                                                      |
| ----- | -------- | ------------------------------------------------------------ |
| OD401 | error    | An unknown view or attribute, or `match` on `day` or `clock` |
| OD402 | error    | A query that doesn't parse                                   |
| OD403 | error    | A view region isn't closed                                   |

## `tasks.v2.md` profile

| Code  | Severity | Meaning                                                                        |
| ----- | -------- | ------------------------------------------------------------------------------ |
| OD501 | warning  | A Planning or Recurrence token with a valid value, which the codec keeps inert |
| OD502 | error    | A context with whitespace, which the current codec can't read back             |
| OD503 | error    | The same `id` on two lines                                                     |
| OD504 | warning  | Task-shaped text in a code block, which the current codec reads as a task      |

## `TASKS.md` profile

| Code  | Severity | Meaning                                                                                         |
| ----- | -------- | ----------------------------------------------------------------------------------------------- |
| OD601 | error    | A top-level task with tokens has no bold title, so the dashboard would pull them into the title |
| OD602 | error    | The dashboard would drop this line: a note, prose, or a task before any `##`                    |
| OD603 | warning  | A marker or indentation the dashboard would change or flatten                                   |
| OD604 | warning  | `@status:` differs from the effective state, so the section or checkbox wins                    |
| OD605 | warning  | An unchecked top-level task in the Done section                                                 |
| OD606 | warning  | A date in prose, such as `due Friday`, with no valid `due:` token                               |
| OD607 | warning  | A top-level task in Waiting On with neither `@waiting:` nor a note                              |

OD602 covers every line except blank lines, `##` headings, a line that is exactly `# Tasks`, and
task-shaped lines after the first `##`. It works on raw text, because the dashboard knows nothing
of fences: a `##` heading in a fence is skipped and counts as that first `##`, a task-shaped line in
a fence counts as a task, and other fenced lines are reported.
OD106 isn't reported in `Waiting On`, where the note or `unspecified` stands in for the reason.
OD108 isn't reported in this profile, because a section outranks `@status:`, and OD604 and OD605
cover the conflict.

OD606 matches this pattern against the title and note, ignoring case:

```text
\b(due|by)\s+(today|tomorrow|next\s+\w+|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|
sat(urday)?|sun(day)?|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b
```
