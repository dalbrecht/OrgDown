# Org mapping

Every major Org feature, and where it went. **Mapped** means an OrgDown construct carries it.
**Native** means plain Markdown already does it. **Out** means OrgDown won't do it, and why.

## Structure and markup

| Org                            | Status | OrgDown                                                         |
| ------------------------------ | ------ | --------------------------------------------------------------- |
| `* Headlines`                  | Native | Markdown headings                                               |
| Headline as a task             | Mapped | A list item. Headings are never tasks, as in the source dialect |
| `*bold*`, `/italic/`, `=code=` | Native | Markdown emphasis and code                                      |
| Plain lists, checkboxes        | Native | GFM task lists                                                  |
| `[1/3]` statistics cookies     | Mapped | The derived [`progress`](01-core.md#2-nesting) field            |
| Tables                         | Native | GFM tables. No formulas                                         |
| Links `[[target][text]]`       | Native | Markdown links                                                  |
| Footnotes                      | Native | GFM footnotes                                                   |
| `#+BEGIN_SRC` blocks           | Native | Fenced code                                                     |
| `#+TITLE`, file keywords       | Native | YAML front matter                                               |
| Comments                       | Native | HTML comments                                                   |

## Tasks

| Org                             | Status | OrgDown                                                          |
| ------------------------------- | ------ | ---------------------------------------------------------------- |
| `TODO`, `NEXT`, `DONE` …        | Mapped | [The eight states](01-core.md#6-state-meanings)                  |
| Custom `#+TODO:` sequences      | Out    | The state set is fixed, so tools can agree on what a state means |
| `[#A]` priority                 | Mapped | `@priority:1`. A is 1, B is 2, C is 3. Ranks go past 3           |
| `:tag:` tags                    | Mapped | `#tag` in the title, with `/` for hierarchy                      |
| Tag inheritance                 | Out    | The source dialect has none, and a line must mean the same alone |
| `DEADLINE:`                     | Mapped | `due:`, `@due-time:`, `@warn:`                                   |
| `SCHEDULED:`                    | Mapped | `defer:`                                                         |
| `CLOSED:`                       | Mapped | `completed:`                                                     |
| Active timestamp `<…>`          | Mapped | `at:`                                                            |
| Inactive timestamp `[…]`        | Native | Plain text                                                       |
| Repeaters `+`, `.+`             | Mapped | `@every:`, `@after:`                                             |
| Repeater `++`                   | Mapped | `@every:` with `@repeat-catch-up:yes`                            |
| Hour repeaters (`+2h`)          | Out    | The model is day-based                                           |
| Yearly repeaters (`+1y`)        | Mapped | `@every:12m`                                                     |
| `:PROPERTIES:` drawers          | Mapped | Core tokens, plus `@x-` for your own                             |
| `Effort` property               | Mapped | `@estimate:`                                                     |
| `LOGBOOK`, clocking             | Mapped | [Logbook](05-logbook.md)                                         |
| State-change notes              | Mapped | `state:` log entries                                             |
| Habits (`STYLE: habit`)         | Mapped | `@habit:yes`, and the `habits` view                              |
| Project dependencies, `BLOCKER` | Mapped | `@status:blocked`. Automatic dependencies are out                |
| Archiving                       | Mapped | The [`archive`](04-operations.md#7-archiving) operation          |

## Agenda and capture

| Org                      | Status | OrgDown                                                        |
| ------------------------ | ------ | -------------------------------------------------------------- |
| Daily and weekly agenda  | Mapped | The [`day`](06-agenda.md#3-the-day-view) and `week` views      |
| Global TODO list         | Mapped | The `list` view                                                |
| Match and tag searches   | Mapped | The [query language](06-agenda.md#2-query-language)            |
| Stuck projects           | Mapped | The `stuck` view                                               |
| Logbook mode             | Mapped | The `logbook` view                                             |
| Clock reports            | Mapped | The `clock` view                                               |
| Custom agenda commands   | Mapped | [Agenda MD](06-agenda.md#6-agenda-md-files) view regions       |
| Agenda files list        | Mapped | Agenda MD `sources`                                            |
| Column view              | Out    | A tool can render one from the same fields                     |
| Capture templates        | Mapped | The [`add`](04-operations.md#6-adding) operation and AI skills |
| Refile                   | Mapped | Moving a line. No tokens change                                |
| Calendar and diary sexps | Out    | They're Lisp                                                   |

## Everything else

| Org                     | Status | Why                                                              |
| ----------------------- | ------ | ---------------------------------------------------------------- |
| Babel, code execution   | Out    | Running code from a file doesn't belong in an interchange format |
| Spreadsheet formulas    | Out    | Same                                                             |
| Export to HTML, LaTeX … | Out    | Every Markdown toolchain already does this                       |
| Encryption, attachments | Out    | These are file-level concerns                                    |
