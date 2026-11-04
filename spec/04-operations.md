# Operations

These are the edits a Writer performs. Each takes a document, a task line and, where needed,
`today`, and returns a new document.

## 1. Two writing modes

**Preserving** mode is the default, for any file that belongs to a person. A writer changes only
the tokens the operation touches, in place, and keeps every other byte of the file. Bullet
style, `[X]`, indentation and token order are not normalized.

- To set a token that exists, replace the value of the last valid one.
- To add a token, append it to the end of the token run, before any trailer.
- To remove a token, remove it and the single space before it. Removing an earlier valid
  duplicate is not required.

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
5. If the task has a recurrence rule, remove all its recurrence tokens from this line, and create
   the next occurrence.

**The next occurrence** exists unless the series has ended. It has ended when `@repeat-count:` is
`0`, or when `next(...)` returns nothing. When it exists, insert a new line after the last
line of the completed task's subtree, counting the [body](05-logbook.md#1-task-body) of the task
and of each descendant, with the same indentation and bullet character, `[ ]`, the same title,
and these tokens, in the source line's order:

- `due:` is set to the next occurrence, added if the source had none.
- `defer:`, `at:` and `@remind:` move by the same number of days as `due:`, if the source had a
  `due:`. If it had none, they are dropped.
- `@status:` is absent if the source state was `inbox`, and otherwise `next`, added if absent.
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
2. Remove `@status:` if its value is closed.
3. Remove `completed:`.

Tools that know nothing of OrgDown only toggle the box, which leaves `completed:` behind. That is
why `completed:` has no effect on an open line. `@status:done` behind an open box stays `done`,
because explicit status wins, and validators report [OD108](07-diagnostics.md).

## 5. Skipping

`skip(line, today)` moves a repeating task to its next occurrence without completing it. It
computes `next(rule, anchor, today, today)`, and then updates `due:`, moves `defer:`, `at:` and
`@remind:` as in §2, and decrements `@repeat-count:`, all in place. Nothing else changes. If the
series has ended, or the task doesn't repeat, the operation is refused and the document is
unchanged.

## 6. Adding

`add(document, section, title, tokens)` inserts a task in canonical form after the last non-blank
line of the named section, which runs up to the next section line. With no section named, or no
such section, it goes after the last non-blank line of the document. The
title MUST NOT contain a newline. It MUST NOT end in a word that opens a token, or the title
would be misread. A writer SHOULD wrap such a final word as inline code or a link.

## 7. Refusals

An operation on a line that is not a task is refused, and the document is unchanged. Refusals
are errors, never partial writes.
