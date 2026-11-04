# Diagnostics

A validator reports stable codes, so tools and skills can act on them. A diagnostic has `code`,
`severity`, `line` (1-based), `message`, and `fix` where a safe rewrite exists. Severity never
changes how a reader parses a file: a reader never fails.

An `error` means a tool will not do what the author meant. A `warning` means a tool will, but the
file is fragile or inconsistent.

## Core and planning

| Code  | Severity | Meaning                                                                      |
| ----- | -------- | ---------------------------------------------------------------------------- |
| OD101 | error    | A known key has an invalid value, so the token is ignored                    |
| OD102 | error    | Text after a token ended the run, so the tokens before it became title text  |
| OD103 | warning  | A key appears twice, so the earlier value is ignored                         |
| OD104 | warning  | An unknown token, which is not an `@x-` extension                            |
| OD105 | warning  | A URL or a word ending in `:` was read as a token. Wrap it                   |
| OD106 | error    | `@status:waiting` with no reason                                             |
| OD107 | error    | `@due-time:` with no valid `due:`                                            |
| OD108 | warning  | The checkbox disagrees with `@status:`                                       |
| OD109 | warning  | `completed:` on an open line                                                 |
| OD111 | warning  | `@priority:` on a closed line                                                |
| OD112 | warning  | `defer:` is after `due:`                                                     |
| OD113 | warning  | Indentation is odd, or isn't a multiple of 2 columns                         |
| OD114 | warning  | The legacy `@project:` token. Nest under an `@kind:project` task instead     |

## Recurrence

| Code  | Severity | Meaning                                                                      |
| ----- | -------- | ---------------------------------------------------------------------------- |
| OD201 | error    | A `@repeat-*` token with no valid `@every:` or `@after:`                     |
| OD202 | error    | `@repeat-on:` with a unit other than `w`                                     |
| OD203 | error    | `@repeat-catch-up:` with `@after:`                                           |
| OD204 | warning  | A repeating task with no `due:`, so it will anchor on the completion day     |
| OD205 | warning  | `@repeat-count:` and `@repeat-until:` together, so whichever ends first wins |

## Logbook

| Code  | Severity | Meaning                                                                      |
| ----- | -------- | ---------------------------------------------------------------------------- |
| OD301 | error    | A `clock:` entry whose end isn't after its start                             |
| OD302 | warning  | More than one running clock                                                  |

## Agenda MD

| Code  | Severity | Meaning                                                                      |
| ----- | -------- | ---------------------------------------------------------------------------- |
| OD401 | error    | An unknown view or attribute                                                 |
| OD402 | error    | A query that doesn't parse                                                   |
| OD403 | error    | A view region isn't closed                                                   |

## `tasks.v2.md` profile

| Code  | Severity | Meaning                                                                      |
| ----- | -------- | ---------------------------------------------------------------------------- |
| OD501 | warning  | A token that the current codec keeps only as an inert extra                  |
| OD502 | error    | A context with whitespace, which the current codec can't read back           |
| OD503 | error    | The same `id` on two lines                                                   |
| OD504 | warning  | Task-shaped text in a code block, which the current codec reads as a task    |

## `TASKS.md` profile

| Code  | Severity | Meaning                                                                      |
| ----- | -------- | ---------------------------------------------------------------------------- |
| OD601 | error    | A top-level task with tokens has no bold title, so the dashboard would pull them into the title |
| OD602 | error    | The dashboard would drop this line: a note, prose, or a task before any `##` |
| OD603 | warning  | A marker or indentation the dashboard would change or flatten                |
| OD604 | warning  | `@status:` doesn't fit the section, so the section wins                      |
| OD605 | warning  | An unchecked task in the Done section                                        |
| OD606 | warning  | A date in prose, such as `due Friday`, which no tool can read                |
| OD607 | warning  | A Waiting On task with neither a reason nor a note                           |
