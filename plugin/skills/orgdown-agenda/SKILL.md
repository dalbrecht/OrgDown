---
name: orgdown-agenda
description: Use when the user asks for an agenda, a plan for today or this week, what's overdue, what's next, what's stuck, a weekly review, or a time report across their Markdown task files, or when working on an Agenda MD file (one with `orgdown:view` comments).
---

# OrgDown agendas

An agenda is a view across task files. Run the tool with
`node "${CLAUDE_PLUGIN_ROOT}/bin/orgdown.mjs"`. Below it's written as `orgdown`.

```bash
orgdown agenda <view> [options] <file or folder>...
```

With no paths, it reads every Markdown file under the current folder. `TASKS.md` and `tasks.v2.md`
are read with their own rules. Rows link back to `file:line`, so you can open or change the task.

| View      | Answers                             | Options                        |
| --------- | ----------------------------------- | ------------------------------ |
| `day`     | What's on today?                    | None                           |
| `week`    | What's coming up?                   | `--start`, `--days`, `--match` |
| `next`    | What can I do now, by context?      | `--match`                      |
| `waiting` | What am I waiting on?               | `--match`                      |
| `list`    | Any query at all                    | `--match`, `--sort`            |
| `stuck`   | Which projects have no next action? | `--match`                      |
| `logbook` | What did I finish?                  | `--from`, `--to`, `--match`    |
| `clock`   | Where did the time go?              | `--from`, `--to`               |
| `habits`  | Am I keeping up my habits?          | `--match`                      |

Don't work this out by reading the files. The tool applies deferrals, warning periods and priority
limits the way every other OrgDown tool does.

## Queries

`--match` takes space-separated terms that must all hold. `-` negates a term.

```text
open  closed  deferred  repeats  due  priority
status:next,waiting  tag:work  context:home  energy:low  kind:project  kind:none
priority<=2  due<=today+7d  defer>=2026-12-01  completed>=today-7d
title:"quoted text"  file:"Work/**"
```

Examples:

```bash
orgdown agenda list --match "open tag:work due<=today+7d" --sort due,priority
orgdown agenda next --match "context:home energy:low"
orgdown agenda logbook --from today-7d
```

## A weekly review

Run these and walk through the results with the user, one at a time: `logbook --from today-7d`,
`stuck`, `waiting`, `week --days 14`, and `list --match "status:inbox"`.

## Agenda MD files

An Agenda MD file keeps saved views in an ordinary Markdown page, which works in any viewer. Set
sources in front matter, and add a region for each view. Everything outside the regions is the
user's, and it's never touched.

```markdown
---
orgdown: 0.1
agenda:
  sources:
    - "Tasks/**/*.md"
    - "TASKS.md"
---

# My agenda

<!-- orgdown:view day -->
<!-- /orgdown:view -->

<!-- orgdown:view next match="-tag:work" title="Personal" -->
<!-- /orgdown:view -->
```

Refresh it, or check whether it's current:

```bash
orgdown regenerate agenda.md
orgdown regenerate agenda.md --check
```

Attributes are `title`, `match`, `sort`, `start`, `days`, `from` and `to`. Use single quotes when a
query holds double quotes: `match='title:"the plan"'`. Never edit between the markers, because the
next regeneration replaces it. To change a task, edit its source file, and then regenerate.
