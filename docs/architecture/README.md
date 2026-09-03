# Architecture

Filled in slice by slice, as each seam is actually built rather than speculated
about. `PRODUCTION_PLAN.md` §2 holds the target shape until then.

Written so far:

- [**Execution backends**](execution-backends.md) — the `ExecutionBackend`
  interface, why a program is bytes rather than a string, and why the handle
  streams (2b-i)
- [**The dialect layer**](dialects.md) — how Viya generation differences are
  absorbed, why version checks are banned everywhere else, why the dialects are
  nearly empty on purpose, and why Viya 3.5 is no longer one of them
  ([ADR-0022](../adr/0022-drop-viya-35-support.md)) (2b-i)
- [**Capability probing**](capability-probing.md) — the two stages, why stage 1
  cannot ask until a session exists, and why fail-soft is sanctioned here and
  nowhere else (2b-ii; stage 2 lands in 3e)
- [**API contracts**](contracts.md) — the REST footprint written down per
  generation, how an absence is recorded, and what the gate does and does not
  assert (2b-ii)
- [**Traceback mapping and the diagnostics surface**](diagnostics-surface.md) —
  `<string>` frames to editor positions and the offset that makes it
  non-trivial (4c), then its two consumers: the Problems-panel
  `DiagnosticCollection` and the result panel's click-to-jump (4d). One page —
  neither half is legible without the other.

Planned pages, each written with the slice that introduces the thing it describes:

- **Log to output** — turning a SAS log into clean Python stdout (3b)
