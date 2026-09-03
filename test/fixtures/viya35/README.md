# Viya 3.5 fixtures

Empty, and honestly so.

This project has not yet talked to a live Viya 3.5 deployment. Until it has, this
directory stays empty and no document may claim Viya 3.5 support — the plan
targets it, `src/dialects/` is where the differences will live, and none of that
is evidence.

Filling this directory from the Viya 3.5 documentation would be worse than
leaving it empty: the suite would go green against a shape nobody has observed,
and the gap would be invisible. When a 3.5 deployment becomes available, capture
the same endpoints already recorded under `viya4/`, sanitise them the same way
(see [../README.md](../README.md)), and record the comparison as a dated finding
in the current phase file's **Probe findings** section (`docs/phases/phase-N.md`,
per `STATUS.md`).
