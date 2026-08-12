# Architecture

Filled in slice by slice, as each seam is actually built rather than speculated
about. `PRODUCTION_PLAN.md` §2 holds the target shape until then.

Planned pages, each written with the slice that introduces the thing it describes:

- **Execution backends** — the `ExecutionBackend` interface, why `PROC PYTHON` is
  the first implementation, and what a second one would have to satisfy (2b, 3a)
- **The dialect layer** — how Viya 3.5 and Viya 4 differences are absorbed, and
  why version checks are banned everywhere else (2b)
- **Capability probing** — the two stages, HTTP-derived and runtime-derived, and
  why fail-soft is sanctioned here and nowhere else (2b, 3e)
- **Log to output** — turning a SAS log into clean Python stdout (3b)
- **Traceback mapping** — `<string>` frames to editor positions, and the wrapper
  offset that makes it non-trivial (4a)
