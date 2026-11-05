# ADR 0001: The spec and vectors are the standard

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

OrgDown has to be implemented independently on several platforms in different languages. A shared
library would tie them together, and would let its bugs define the format.

## Decision

The standard is the prose in `spec/` plus the JSON vectors in `conformance/vectors/`. The vectors
are language-neutral: an implementation runs them with its own harness. The CLI in this repository
is a reference implementation with no special status. If it disagrees with the spec, it has a bug.
If the prose and a vector disagree, that's a spec bug to fix in both.

## Consequences

- Every normative rule needs a vector, or it isn't really tested.
- A second implementation, built only from the spec, is the real test of the spec.
- Platforms never depend on this repository at runtime.
