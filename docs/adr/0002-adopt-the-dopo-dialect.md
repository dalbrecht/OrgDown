# ADR 0002: Build on the Dopo Tasks dialect, not Org syntax

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Org syntax doesn't survive in Markdown. In a fenced block nothing can be checked off. Unfenced,
`* TODO` is a bullet and `:PROPERTIES:` is stray text, and a Markdown editor may rewrite both. Org
tools read `.org` files, not Org inside `.md`.

Dopo Tasks already ships a Markdown task-line format that it reads and writes two-way: a GFM
checkbox, a title, a trailing run of `key:value` tokens, and an optional comment trailer. Real files
already use it.

## Decision

OrgDown's line format is that dialect. Org's concepts are mapped onto it. Where the two differ, the
dialect wins: tasks are list items and not headings, tokens come last, `done` and `trash` are the
closed states, and dates are days. New tokens fill gaps, and they only use forms the shipped codec
already keeps as extras, so a file with new tokens is safe in older builds.

Core differs from the shipped codec in one way on purpose: fenced code, front matter and comment
blocks are opaque. The codec reads task-shaped lines there as tasks, which is wrong for any page
that documents the format. The `tasks.v2.md` profile records what the codec does today.

Core also adds quoted `@context:` values, because the shipped format can't express a name with a
space.

## Consequences

- Dopo Tasks is close to Reader conformance already, and the remaining gaps are listed in its
  profile.
- OrgDown files look nothing like Org, and that's accepted. The Org mapping document carries the
  concepts across.
- Org's custom state sequences are out, because a fixed set is what lets tools agree.
