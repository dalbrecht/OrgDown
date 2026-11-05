# ADR 0003: `@every:` means Org's `+`, not `++`

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Org has three repeaters. `+1w` shifts the date by one interval, and it may stay in the past. `++1w`
shifts until the date is in the future, keeping the weekday. `.+1w` shifts from the completion date.

Earlier design notes mapped `++1w` to `@every:1w`. That's wrong. The shipped recurrence engine steps
exactly once from the due date, even when the result is in the past, which is `+`. Callers who want
to fast-forward skip repeatedly.

## Decision

- `@every:` is `+`, matching the engine.
- `@after:` is `.+`.
- `@every:` with `@repeat-catch-up:yes` is `++`. This is new. The engine doesn't support it yet, and
  without it `++` tasks couldn't be exchanged. In an older build the token is kept as an inert extra,
  and the task behaves as `+`, which is the safest way to fail: an extra occurrence rather than a
  missed one.

## Consequences

Anything built on the earlier mapping needs correcting: an Org `++` task imported as bare `@every:`
piles up past occurrences after a holiday.
