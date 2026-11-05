# OrgDown specification

**Version 0.1 (draft).** Token names and rules can still change before 1.0.

OrgDown brings Emacs Org mode's task and agenda model to plain Markdown. An OrgDown file is an
ordinary GFM file: it renders as a checklist anywhere, and a tool that knows nothing about
OrgDown can toggle a checkbox without breaking it.

```markdown
## Garden

- [ ] Order seeds #home @status:next @context:computer due:2026-11-14 @priority:1
- [ ] Water the beds @every:3d due:2026-11-06
- [ ] Renew plot lease @status:waiting @waiting:"council reply" due:2026-12-01
  - [x] Send the form completed:2026-11-02
```

## Design rules

1. **Markdown first.** Every OrgDown file is valid GFM. Nothing is hidden in a sidecar.
2. **Plain files are the interface.** Implementations share the format and the test vectors,
   never code.
3. **The shipped dialect wins.** OrgDown is built on the task-line dialect that Dopo Tasks
   already reads and writes. Where Org's model and that dialect differ, the dialect is kept and
   Org is mapped onto it ([ADR 0002](../docs/adr/0002-adopt-the-dopo-dialect.md)).
4. **Nothing is lost.** A reader keeps what it doesn't understand, so older tools can carry
   newer tokens.

## Documents

| Document                                      | Covers                                                |
| --------------------------------------------- | ----------------------------------------------------- |
| [Core](01-core.md)                            | Lines, tasks, tokens, states, nesting, reading rules  |
| [Planning](02-planning.md)                    | Dates, times, priority, estimates, reminders          |
| [Recurrence](03-recurrence.md)                | Repeat rules and next-occurrence math                 |
| [Operations](04-operations.md)                | Complete, reopen, skip, add; preserving and canonical |
| [Logbook](05-logbook.md)                      | Clock entries and state history                       |
| [Agenda](06-agenda.md)                        | Views, the query language, Agenda MD files            |
| [Diagnostics](07-diagnostics.md)              | Stable validator codes                                |
| [`tasks.v2.md` profile](profiles/tasks-v2.md) | Files managed by Dopo Tasks                           |
| [`TASKS.md` profile](profiles/tasks-md.md)    | The Claude productivity task board                    |
| [Org mapping](org-mapping.md)                 | Every Org feature: mapped, native, deferred or out    |

## Conformance

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. An
implementation claims one or more of these classes. Each class is a set of modules, and each
module has test vectors in [`conformance/vectors`](../conformance/vectors).

| Class      | Requires                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| **Reader** | Core, Planning and Recurrence parsing                                    |
| **Writer** | Reader, plus Operations                                                  |
| **Agenda** | Reader, plus next-occurrence math and Agenda                             |
| **Full**   | Writer, Agenda, Logbook, and every profile the implementation advertises |

An implementation MUST pass every vector of the classes it claims, and MUST NOT claim a class
because it passes most of them. Known deviations are listed by the implementation itself, not
in this specification.

## Versioning

The spec uses semantic versions. Before 1.0, a minor version may change behavior. After 1.0, a
new token or view is a minor change, and a changed reading of an existing token is a major one.
A file MAY declare its version in front matter (`orgdown: 0.1`). Readers MUST NOT refuse a file
because of that key.

## Notation

- `YYYY-MM-DD` is a real calendar day in the proleptic Gregorian calendar.
  `2026-13-40` and `2026-02-30` are not dates.
- `HH:MM` is 24-hour local wall-clock time, `00:00` to `23:59`.
- Dates have no time zone. "Today" is always supplied by the caller and SHOULD be the user's
  local calendar day. Implementations MUST take it as an input, so results are reproducible.
- `<n>` is a decimal integer with no sign and no leading zeros.
