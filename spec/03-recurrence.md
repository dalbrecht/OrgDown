# Recurrence

A repeating task is one line. It always shows the current occurrence. Completing it finishes
that occurrence and creates the next ([Operations](04-operations.md)).

## 1. Tokens

| Token               | Value                                                     | Rule field                          | Org equivalent |
| ------------------- | --------------------------------------------------------- | ----------------------------------- | -------------- |
| `@every:`           | `<n><d\|w\|m>`, `n ≥ 1`                                   | `mode: due`, `every`, `unit`        | `+1w`          |
| `@after:`           | `<n><d\|w\|m>`, `n ≥ 1`                                   | `mode: completion`, `every`, `unit` | `.+1w`         |
| `@repeat-on:`       | comma-separated `sun` `mon` `tue` `wed` `thu` `fri` `sat` | `weekdays`                          | None           |
| `@repeat-until:`    | `YYYY-MM-DD`, inclusive                                   | `until`                             | None           |
| `@repeat-count:`    | `<n>`, `n ≥ 0`: occurrences remaining after this one      | `count`                             | None           |
| `@repeat-catch-up:` | `yes`                                                     | `catchUp`                           | `++1w`         |
| `@habit:`           | `yes`                                                     | `habit`                             | `STYLE: habit` |

In `@every:` and `@after:`, `n` is at most 9999. A larger value is malformed, which bounds the work
a file can cause.

There is no yearly unit. Use `12m`. There are no hourly repeats, no "second Tuesday of the
month" rules, and no per-occurrence exceptions.

The `recurrence` field is an object with `mode`, `every`, `unit`, and any of `weekdays` (numbers,
`0` Sunday to `6` Saturday, sorted, without duplicates), `until`, `count` and `catchUp` that are
set, or `null` if the task doesn't repeat.

## 2. Reading a rule

**Each token alone.** A token with a malformed value is an extra, as usual. `@every:` and
`@after:` count as one key, so the last valid one wins, and `@every:1w @after:0w` is a weekly
rule with `@after:0w` kept as an extra. `@repeat-on:mon,funday` is malformed as a whole.

**Then the assembled rule.** These tokens are extras too, at their place on the line, whether or
not a later duplicate exists, because no rule uses them:

- every `@repeat-*` token, when there is no valid `@every:` or `@after:`;
- `@repeat-on:` with a unit other than `w`;
- `@repeat-catch-up:` with `@after:`.

`@habit:` isn't part of the rule. It sets the boolean `habit` field, which is `false` without it, and
it needs no rule to be read.

## 3. Next occurrence

`next(rule, anchor, completed, today)` returns a day, or nothing if the series has ended.

- `anchor` is the current `due:`, or `today` if there is none.
- `base` is `anchor` in `due` mode. In `completion` mode it is `completed`, or `today` if that
  is absent.

The candidate is:

- **With weekdays:** the first day `d` after `base`, up to and including `base + 7 × (every + 1)` days, whose
  weekday is in the set and, in `due` mode only, whose week is an on-week. Weeks start on Sunday.
  A day is in an on-week if the number of weeks between its week and the anchor's week is a
  multiple of `every`. If no day qualifies, the series has ended.
- **Otherwise,** `base` plus `every` days, or `every × 7` days, or `every` months.

**Month steps** add the months and clamp to the last day of the target month, so January 31 plus
one month is February 28 or 29. The clamp is sticky: the next step starts from the clamped day,
because the line stores no original day.

**Late completion.** `due` mode advances exactly one step, even if the result is still in the
past. That is Org's `+`. With `@repeat-catch-up:yes`, the step repeats until the candidate is
after `today`, which is Org's `++`. Each repeat is a single occurrence for counting purposes, so
catching up consumes `@repeat-count:` once.

**Ending.** If the candidate is after `until`, the series has ended.

`count` is not part of this function. Operations check it first
([§2 of Operations](04-operations.md#2-completing)).

## 4. Why the Org mapping is what it is

`@every:` is Org's `+`, not `++`, because the existing engine steps once from the due date.
Keeping this was deliberate ([ADR 0003](../docs/adr/0003-repeater-mapping.md)). The two differ only
after a task is completed late.
