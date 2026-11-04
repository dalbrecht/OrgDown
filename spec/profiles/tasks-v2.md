# The `tasks.v2.md` profile

Dopo Tasks keeps a two-way sync with a file named `tasks.v2.md` in a folder the user links. This
is where the OrgDown line format comes from. Dopo owns this file, so other tools are guests in it.
This profile applies when a file's name is exactly `tasks.v2.md`.

## Differences from Core

The current Dopo codec differs from Core in these ways. Inside this file, what the codec does is
what happens, so writers must plan around it.

| Topic           | Core                                     | `tasks.v2.md` today                                       |
| --------------- | ---------------------------------------- | --------------------------------------------------------- |
| Code fences     | Lines inside are opaque                  | Task-shaped lines inside are read as tasks                |
| Front matter    | Opaque                                   | Passthrough, but task-shaped lines inside are tasks       |
| Comment blocks  | Opaque                                   | Passthrough, but task-shaped lines inside are tasks       |
| Quoted contexts | `@context:"Home Office"` is `Home Office` | The quotes stay in the value, so the lookup fails         |
| Spaces in names | Written quoted                           | Written bare, so the line reads back as title text        |
| Planning tokens | Fields                                   | Kept as inert extras                                      |
| Recurrence      | Fields                                   | Kept as inert extras                                      |

## Rules for other tools

Dopo rewrites the whole file in [canonical form](../01-core.md#7-canonical-form), so preserving
bytes isn't possible here.

- **MUST NOT** mint or edit a trailer. An `id` and `rev` come only from Dopo.
- **MUST NOT** add a [Planning](../02-planning.md) or [Recurrence](../03-recurrence.md) token to
  this file until the codec reads it. A token Dopo stores as an extra goes stale as soon as the
  item changes in the app.
- **MUST NOT** use a context name with whitespace.
- **MAY** add a new line with no trailer. Dopo treats it as a new item, and stamps an id on it.
- **MAY** edit an existing line's title, checkbox or Core tokens, and leave the trailer as it is.
  Dopo reconciles the edit against `rev` three ways: fast-forward, stale file, or conflict.
- A line whose item was deleted in the app is dropped from the file on the next write.
- A passthrough line stays in place while tasks keep their order. If a move in the app means the
  old order no longer expresses the outline, Dopo re-renders tasks in outline order, and prose
  after the first task moves below them. Don't rely on notes staying beside a task here.
- Whether an external create keeps its extras on first write-back isn't settled yet.

Validators report these as [OD501 to OD504](../07-diagnostics.md).

## Fields

| Core field        | Dopo item field | Notes                                       |
| ----------------- | --------------- | ------------------------------------------- |
| `due`             | `dueAt`         | Stored as UTC midnight                      |
| `defer`           | `deferAt`       | Stored as UTC midnight                      |
| `context`         | `contextId`     | Resolved by name, ignoring case             |
| `waitingReason`   | `waitingOn`     |                                             |
| `nodeKind`        | `kind`          |                                             |

Dopo's day boundary is currently UTC, which can differ from the local day that OrgDown recommends
for `today`.
