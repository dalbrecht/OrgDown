# Implementations

Each folder here is an independent implementation of OrgDown.

| Folder    | Language | Written from                  | Conformance |
| --------- | -------- | ----------------------------- | ----------- |
| `python/` | Python 3 | The spec and the vectors only | Full        |

The reference CLI in `src/` is the other one, and it's checked against these on random documents
in `tests/differential.test.ts`. When the two disagree, either one has a bug or the spec has a gap.

```bash
python3 -I implementations/python/run_vectors.py
```

The Python code has no dependencies. To add an implementation, run the
[vectors](../conformance/README.md) with your own harness, and list what you pass.
