# Architecture

Filled in slice by slice, as each seam is actually built rather than speculated
about. `PRODUCTION_PLAN.md` §2 holds the target shape until then.

Written so far:

- [**Execution backends**](execution-backends.md) — the `ExecutionBackend`
  interface, why a program is bytes rather than a string, and why the handle
  streams (2b-i)
- [**The dialect layer**](dialects.md) — how Viya 3.5 and Viya 4 differences are
  absorbed, why version checks are banned everywhere else, and why the dialects
  are nearly empty on purpose (2b-i)

Planned pages, each written with the slice that introduces the thing it describes:

- **Capability probing** — the two stages, HTTP-derived and runtime-derived, and
  why fail-soft is sanctioned here and nowhere else (2b, 3e)
- **Log to output** — turning a SAS log into clean Python stdout (3b)
- **Traceback mapping** — `<string>` frames to editor positions, and the wrapper
  offset that makes it non-trivial (4a)
