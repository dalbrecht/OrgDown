<!-- orgdown:begin -->

## OrgDown task files

Task lines in this project's Markdown use OrgDown: a GFM checkbox, a title, then tokens at the very
end of the line, as in `- [ ] Ship it #work @status:next due:2026-11-14 @priority:1`.

- Tokens come last. Anything after a token turns the whole line into title text.
- Change tasks with `orgdown complete|reopen|trash|skip <file> <line> --expect <text>`, and add them
  with `orgdown add`. Run `orgdown validate <file>` after editing a file by hand.
- Keep tokens you don't recognize. Never invent an `<!-- id:… rev:… -->` trailer.
- In `TASKS.md`, write `- [ ] **Title** - note tokens`, and never add prose or note bullets: the
  board rewrites the whole file and deletes them. A section sets a task's status, so move the line
  rather than adding `@status:`.
- In `tasks.v2.md`, add only Core tokens. Dopo Tasks owns that file.
- For views across files, run `orgdown agenda day|week|next|waiting|list|stuck|logbook|clock`.
<!-- orgdown:end -->
