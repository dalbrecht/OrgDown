# OrgDown

Org mode's task and agenda model in plain Markdown.

```markdown
## Garden

- [ ] Order seeds #home @status:next @context:computer due:2026-11-14 @priority:1
- [ ] Water the beds @every:3d due:2026-11-06
- [ ] Renew plot lease @status:waiting @waiting:"council reply" due:2026-12-01
  - [x] Send the form completed:2026-11-02
```

That file is ordinary GFM. It renders as a checklist anywhere, and a tool that has never heard of
OrgDown can toggle a box without breaking it. Tools that do know OrgDown get TODO states, priorities,
deadlines, repeaters, clocking and agendas, the things that make Org mode worth using, without
leaving Markdown.

**Status: 0.1 draft.** Token names can still change before 1.0.

## What's here

| Path                                    | What it is                                                    |
| --------------------------------------- | ------------------------------------------------------------- |
| [`spec/`](spec/README.md)               | The standard                                                  |
| [`conformance/`](conformance/README.md) | Language-neutral test vectors, which are part of the standard |
| `src/`, `plugin/bin/orgdown.mjs`        | The reference CLI: a validator, agendas and safe edits        |
| [`plugin/`](plugin/)                    | A Claude Code plugin with skills and a write-checking hook    |
| `plugin/codex/AGENTS.snippet.md`        | The same guidance for Codex and other agents                  |
| `implementations/python/`               | A second implementation, written from the spec alone          |

The standard is the spec and the vectors, not any code here. To implement OrgDown, read the
[spec](spec/README.md), and run the [vectors](conformance/README.md) with your own harness.

## Install the Claude Code plugin

```text
/plugin install orgdown --marketplace dalbrecht/OrgDown
```

The plugin works alongside Claude's productivity plugin. Claude keeps using `TASKS.md` as before, and
the plugin keeps its lines in the one shape the task board's dashboard can't damage, with dates and
priorities that any tool can read. It adds these:

- `orgdown-format`: reading and changing task lines, and an Org-to-OrgDown cheat sheet
- `orgdown-tasks-md`: working in `TASKS.md`, safely for the dashboard
- `orgdown-agenda`: agendas, queries, weekly reviews and Agenda MD files
- `/orgdown:agenda`: today's agenda, or any other view
- a hook that checks `TASKS.md` and `tasks.v2.md` after every write

## Use the CLI

It needs Node 22 or later, and has no dependencies.

```bash
node plugin/bin/orgdown.mjs validate Tasks/*.md
node plugin/bin/orgdown.mjs agenda day Tasks/ TASKS.md
node plugin/bin/orgdown.mjs agenda list --match "open tag:work due<=today+7d" --sort due
node plugin/bin/orgdown.mjs complete TASKS.md 12 --expect "Water"
```

Run `orgdown --help` for everything. Edits keep every other byte of the file, and they're refused if
the file changed underneath them.

### Agenda MD

An Agenda MD file keeps saved views in an ordinary page. `orgdown regenerate agenda.md` refreshes
the regions, and leaves the rest of the page alone.

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
```

## Coming from Org

| Org                   | OrgDown                                                    |
| --------------------- | ---------------------------------------------------------- |
| `TODO`, `NEXT`        | `- [ ]`, `@status:next`                                    |
| `WAITING`             | `@status:waiting @waiting:"who or what"`                   |
| `DONE`, `CANCELLED`   | `- [x]`, `- [x] … @status:trash`                           |
| `[#A]`                | `@priority:1`                                              |
| `DEADLINE:`           | `due:2026-11-14`                                           |
| `SCHEDULED:`          | `defer:2026-11-14`                                         |
| `CLOSED:`             | `completed:2026-11-14`                                     |
| `+1w`, `++1w`, `.+1w` | `@every:1w`, `@every:1w @repeat-catch-up:yes`, `@after:1w` |
| `:tag:`               | `#tag`                                                     |

The [full mapping](spec/org-mapping.md) covers every major Org feature, including what's left out
and why. OrgDown doesn't embed Org syntax in Markdown, because
[it doesn't survive there](docs/adr/0002-adopt-the-dopo-dialect.md).

## Development

```bash
make install
make ci
```

`make ci` runs the linters, rebuilds the CLI bundle, runs the tests, and fails if the committed
bundle is stale. Decisions are recorded in [`docs/adr/`](docs/adr).

## License

[MIT](LICENSE)
