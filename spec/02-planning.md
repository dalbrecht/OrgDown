# Planning

All of these tokens follow the [reading rules](01-core.md#5-reading-rules): a bad value is kept
as an extra, and the last valid duplicate wins.

| Token        | Value                                  | Field             | Org equivalent                  |
| ------------ | -------------------------------------- | ----------------- | ------------------------------- |
| `due:`       | `YYYY-MM-DD`                           | `due`             | `DEADLINE:`                     |
| `defer:`     | `YYYY-MM-DD`                           | `defer`           | `SCHEDULED:`                    |
| `@due-time:` | `HH:MM`                                | `dueTime`         | The time in a `DEADLINE:` stamp |
| `@warn:`     | `<n>d`                                 | `warnDays`        | `-3d` in a `DEADLINE:` stamp    |
| `at:`        | a date, datetime or range (see below)  | `at`              | An active timestamp `<…>`       |
| `@remind:`   | `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`     | `remind`          | None                            |
| `@estimate:` | `<n>m` or `<n>h`, `n ≥ 1`              | `estimateMinutes` | The `Effort` property           |
| `@priority:` | `<n>`, `n ≥ 1`, 1 highest              | `priority`        | `[#A]` is 1, `[#B]` 2, `[#C]` 3 |
| `@today:`    | `YYYY-MM-DD`                           | `today`           | None                            |
| `completed:` | `YYYY-MM-DD`                           | `completed`       | `CLOSED:`                       |

## Meanings

- **`due:`** is the day something must be finished by.
- **`defer:`** is the day it becomes relevant. Before that day the task is hidden from lists of
  things to do. This is Org's `SCHEDULED`, read as "don't show me this before".
- **`@due-time:`** is a wall-clock time on the due day. It is only valid with a valid `due:` on
  the same line. Otherwise it is an extra. Date math never uses it.
- **`@warn:`** is how many days before `due:` the task starts to appear on the
  [day view](06-agenda.md#3-the-day-view). The default is 1, so a task due tomorrow is on
  today's agenda. `@warn:0d` means only on the day itself.
- **`at:`** is an appointment: something that happens at a time, with no task to finish. Values
  are one of:
  - a day: `2026-11-05`
  - a start: `2026-11-05T14:00`
  - a same-day range: `2026-11-05T14:00/15:30`, where the end is after the start
  - a range across days: `2026-11-05T14:00/2026-11-06T09:00`, where the end is after the start

  The field is an object with `start` and, for a range, `end`, each as written, with a
  same-day end expanded to a full datetime.
- **`@remind:`** asks for a reminder. Only tools that can notify act on it.
- **`@estimate:`** is expected effort. `@estimate:1h` and `@estimate:60m` both read as 60.
- **`@priority:`** is a rank, not a level: `1` comes first. Ranks may tie or have gaps. Ties
  break by document order. A closed task's priority is ignored.
- **`@today:`** means "I chose to do this on that day". It puts the task on that day's agenda
  and no other. A marker from an earlier day has no effect.
- **`completed:`** is the day the task was closed. It has no effect on an open line.

## Dopo Tasks field mapping

The fields above already exist in Dopo Tasks' model, so a reader there can store them directly.

| Field             | Dopo item field                                   |
| ----------------- | ------------------------------------------------- |
| `priority`        | `priorityRank`, which is 0-based: `priority − 1`  |
| `today`           | `decidedOn`                                       |
| `completed`       | `completedAt`, as a UTC day                       |
| `dueTime`         | `dueTimeMinutes`                                  |
| `estimateMinutes` | `timeEstimateMinutes`                             |
| `remind`          | `remindAt`                                        |

`warnDays` and `at` have no Dopo field yet. Dopo's Today rule behaves like `@warn:1d`.
