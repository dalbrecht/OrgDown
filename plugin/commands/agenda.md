---
description: Show today's agenda, or another OrgDown view, across your Markdown task files
argument-hint: [view] [paths]
---

Use the `orgdown-agenda` skill.

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/orgdown.mjs" agenda` with "$ARGUMENTS". If that's empty, use the
`day` view. Summarize the result, leading with anything overdue, and give the rows as links.
