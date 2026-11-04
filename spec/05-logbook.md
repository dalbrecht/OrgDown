# Logbook

Org keeps a `LOGBOOK` drawer under a headline, with clock entries and state changes. OrgDown keeps
them as plain list items in the task's body. This module is optional for Readers and Writers, and
required for Full conformance.

## 1. Task body

A task's **body** is the run of lines directly after it that are blank, or passthrough lines
indented deeper than the task's own indentation. It ends at the first task line, section, opaque
line, or passthrough line that isn't indented that deep. Trailing blank lines aren't part of it.

The body is the task's notes. Readers expose it as `body`, a list of lines with the task's
indentation plus two spaces removed.

## 2. Log entries

A body line is a **log entry** when it is a list item (`- `) whose text matches one of these:

| Entry | Form                                                      | Meaning                       |
| ----- | --------------------------------------------------------- | ----------------------------- |
| Clock | `clock:<start>/<end>`                                     | Time worked                   |
| Clock | `clock:<start>/`                                          | A running clock               |
| State | `state:<to> from:<from> on:<YYYY-MM-DDTHH:MM>`            | A state change                |

`<start>` is `YYYY-MM-DDTHH:MM`. `<end>` is `HH:MM` on the same day, or a full datetime. `<end>`
MUST be after `<start>`, and otherwise the line is plain body text. `<to>` and `<from>` are states.

```markdown
- [ ] Draft the report @status:in-progress
  - clock:2026-11-04T09:00/10:30
  - clock:2026-11-04T14:00/
  - state:in-progress from:next on:2026-11-04T09:00
```

Readers expose these as `log`, a list of `{ "type": "clock", "start", "end", "minutes" }` and
`{ "type": "state", "to", "from", "on" }` objects, in document order. A running clock has
`end: null` and `minutes: null`.

## 3. Writing

- `clockIn(line, now)` adds a running entry as the first line of the body. It is refused if the
  document has a running clock anywhere.
- `clockOut(line, now)` closes the running entry on that line. It is refused if `now` isn't after
  the start.
- A Writer MAY log state changes. It adds the entry as the first line of the body.

New entries go first, so the newest is on top, as in Org. Log entries come before any child task,
because the body ends at the first task line.

The [clock report](06-agenda.md#4-other-views) adds up closed entries. A running clock counts for
nothing until it's closed.
