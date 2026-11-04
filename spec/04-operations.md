# Operations

These are the edits a Writer performs. Each takes a document, a task line and, where needed,
`today`, and returns a new document.

## 1. Two writing modes

**Preserving** mode is the default, for any file that belongs to a person. A writer changes only
the tokens the operation touches, in place, and keeps every other byte of the file. Bullet
style, `[X]`, indentation and token order are not normalized.

- To set a token that exists, replace the value of the last valid one.
- To add a token, append it to the end of the token run, before any trailer. A trailer that
  directly follows an empty title gets a space before it. When several are
  added, they go in the order the operation lists them.
- To remove a key, remove every token of that key with a valid value, and the single whitespace
  character before each. Extras stay.

**Canonical** mode is for a file an application owns and rewrites whole
([`tasks.v2.md`](profiles/tasks-v2.md)). The application renders every task line in
[canonical form](01-core.md#7-canonical-form).

A preserving writer MUST use compare-and-swap or an equivalent check when the file may have
changed since it was read.

## 2. Completing

`complete(line, today)`:

1. Set the checkbox to `[x]`. If it is already checked, keep the original character.
2. If the line has a `@status:` token, set it to `done`.
3. Set `completed:` to `today`.
4. Remove `@priority:` and `@waiting:`. A finished task holds no rank and waits on nobody.
5. If the task has a recurrence rule, remove its tokens from this line, including any duplicates a
   later token replaced, and create the next occurrence. Extras stay.

Child tasks aren't touched. A task can be closed with open children.

**The next occurrence** exists unless the series has ended. It has ended when `@repeat-count:` is
`0`, or when `next(...)` returns nothing. When it exists, insert a new line after the last
line of the completed task's subtree, counting the [body](05-logbook.md#1-task-body) of the task
and of each descendant. The new line is a copy of the source line, bytes included, with `[ ]`, no
trailer, no trailing whitespace, and these changes to its tokens:

- `due:` is set to the next occurrence, added if the source had none.
- `defer:`, `at:` and `@remind:` move by the same number of days as `due:`, if the source had a
  `due:`. If it had none, they are dropped. A move changes the dates in the value as written, so
  `at:2026-11-04T14:00/15:00` keeps its short end. As with any set, a duplicate a later token
  replaced isn't moved.
- `@status:` is absent if the source state was `inbox`, and otherwise `next`, added after `due:` if
  the source had none. The source state is the one Core gives the line alone.
- `@repeat-count:` is decremented. The rest of the rule is kept.
- `@priority:`, `@today:`, `@waiting:`, `completed:` and any trailer are dropped.
- All other tokens are kept, including extras and `@kind:`.

Child tasks are not copied.

## 3. Trashing

`trash(line, today)` is `complete` with `@status:trash`, which is added if absent, and no next
occurrence. All recurrence tokens stay on the line, so the rule is not lost if it's reopened.

## 4. Reopening

`reopen(line)`:

1. Set the checkbox to `[ ]`.
2. Remove every `@status:` token with a closed value.
3. Remove every `completed:` token, valid or not.

Tools that know nothing of OrgDown only toggle the box, which leaves `completed:` behind. That is
why `completed:` has no effect on an open line. `@status:done` behind an open box stays `done`,
because explicit status wins, and validators report [OD108](07-diagnostics.md).

## 5. Skipping

`skip(line, today)` moves a repeating task to its next occurrence without completing it. It
computes `next(rule, anchor, today, today)`, and then updates `due:`, moves `defer:`, `at:` and
`@remind:` as in §2, and decrements `@repeat-count:`, all in place. If the task has no `due:`, the
other dates stay as they are. Nothing else changes. If the series has ended, or the task doesn't
repeat, the operation is refused and the document is unchanged.

## 6. Adding

`add(document, section, title, tokens)` inserts a task after the last non-blank line of the named
section, or right after its heading if it's empty. A section runs up to the next section line, and
its name matches the heading text exactly. With no section named, or no such section, the task goes
after the last non-blank line of the document, and an empty document becomes just the new line.

`tokens` is a list of `key:value` strings, written as given in canonical order, even `@status:inbox`.
A token that a reader would keep as an extra, other than an `@x-` extension, is refused, so a typo
like `priority:1` fails at once instead of sitting there doing nothing. The line is always
`[ ]`, so a closed `@status:` is refused. The title MUST NOT contain a newline. It MUST NOT end in a
word that opens a token, or the title would be misread, so such a title is refused. A writer SHOULD
wrap that word as inline code or a link.

## 7. Archiving

`archive(document, line)` removes a closed task and its subtree from the document, and returns the
removed lines, unchanged, along with the new document. Archiving an open task, or a task that
isn't at depth 0, is refused.

A tool appends the returned lines to an archive file, which is an ordinary OrgDown file. With
several tasks, it appends them in document order. Nothing about a task changes when it's archived.

## 8. Refusals

An operation on a line that is not a task is refused, and the document is unchanged. Refusals
are errors, never partial writes.
