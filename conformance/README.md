# Conformance vectors

These files are part of the standard. An implementation runs them with its own harness, in any
language. No code here is required.

| File                       | Module      | Class                                                    |
| -------------------------- | ----------- | -------------------------------------------------------- |
| `vectors/core.json`        | Core        | Reader                                                   |
| `vectors/planning.json`    | Planning    | Reader                                                   |
| `vectors/recurrence.json`  | Recurrence  | Reader (`parse` cases), Agenda and Writer (`next` cases) |
| `vectors/operations.json`  | Operations  | Writer                                                   |
| `vectors/logbook.json`     | Logbook     | Full                                                     |
| `vectors/agenda.json`      | Agenda      | Agenda                                                   |
| `vectors/diagnostics.json` | Diagnostics | Validators                                               |
| `vectors/tasks-md.json`    | `TASKS.md`  | That profile                                             |

## Format

Each file is `{ "module", "op", "cases": [...] }`. A case has an `id`, and its `op` if the file's
`op` is `mixed`. `profile` defaults to `core`, and may be `tasks-md` or `tasks-v2`.

| Op                        | Inputs                                          | `expect`                                                                        |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `parse`                   | `input`                                         | `kinds`, if present, lists every line's kind. `tasks` lists every task in order |
| `next`                    | `rule`, `anchor`, `completed?`, `today`         | A date or `null`                                                                |
| `complete` `trash` `skip` | `input`, `line`, `today`                        | The new document, or `{ "refused": true }`                                      |
| `reopen`                  | `input`, `line`                                 | The new document, or `{ "refused": true }`                                      |
| `add`                     | `input`, `section?`, `title`, `tokens`, `note?` | The new document, or `{ "refused": true }`                                      |
| `archive`                 | `input`, `line`                                 | `text` and `removed`, or `{ "refused": true }`                                  |
| `clockIn` `clockOut`      | `input`, `line`, `now`                          | The new document, or `{ "refused": true }`                                      |
| `query`                   | `input`, `path?`, `query`, `today`              | Matching core titles, or `{ "error": true }`                                    |
| `view`                    | `view`, `attrs?`, `docs`, `today`               | The rendered Markdown                                                           |
| `agendaMd`                | `path`, `input`, `files`, `today`               | The regenerated file, or `{ "error": true }`                                    |
| `validate`                | `input`, `profile?`                             | Diagnostics, in order, comparing `code`, `line` and `severity`                  |
| `fix`                     | `input`, `profile`                              | The new document                                                                |
| `toCore`                  | `input`                                         | The new document                                                                |
| `fromCore`                | `input`                                         | `text`, and the number of `warnings`                                            |

A task object in `expect` lists only the fields under test. Every field it lists MUST match, and
`null` means the field is absent or null. `parent` is the 1-based index of the parent in the
document's task list, or `null`. `kinds` uses `task`, `section`, `passthrough` and `opaque`.

The field names are those in the spec: `title`, `state`, `depth`, `checked`, `marker`, `tags`,
`extraTokens`, `context`, `project`, `nodeKind`, `energy`, `waitingReason`, `due`, `defer`,
`dueTime`, `warnDays`, `at`, `remind`, `estimateMinutes`, `priority`, `today`, `completed`,
`recurrence`, `habit`, `progress`, `id`, `rev`, `body`, `log`, and `note` in the `TASKS.md` profile.
