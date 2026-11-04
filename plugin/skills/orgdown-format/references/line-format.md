# Editing OrgDown lines by hand

Use this only when the `orgdown` tool can't run. Change only what's listed, and keep the rest of the
line and file as it is.

## Completing

1. Set the box to `[x]`.
2. If the line has `@status:`, set it to `done`.
3. Add or update `completed:<today>`, before any `<!-- … -->` trailer.
4. Remove `@priority:` and `@waiting:`.

## Completing a repeating task

The line has `@every:` or `@after:`. Do the steps above, and also remove `@every:`, `@after:`
and the `@repeat-*` tokens from the finished line. Then insert a new line after the task, its notes
and its subtasks, with the same indent and bullet:

- `[ ]`, with the same title
- the recurrence tokens, with `@repeat-count:` one lower
- `due:` moved to the next occurrence
- `defer:`, `at:` and `@remind:` moved by the same number of days. If the task had no `due:`, drop
  them instead
- `@status:next`, unless the task had no `@status:`, in which case leave it out
- no `@priority:`, `@today:`, `@waiting:`, `completed:` or trailer

There's no next occurrence if `@repeat-count:` is `0`, or the next date is after `@repeat-until:`.

**The next date.** `@every:` steps once from the old `due:`, even if the result is still in the past.
With `@repeat-catch-up:yes`, keep stepping until the date is after today. `@after:` steps from today.
A month step clamps to the end of the month, so January 31 plus one month is February 28.

## Reopening

Set the box to `[ ]`, and remove `completed:` and any `@status:done` or `@status:trash`.
