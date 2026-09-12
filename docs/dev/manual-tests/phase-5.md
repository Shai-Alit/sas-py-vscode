<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 5 (Hardening & first release)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend. These items were originally folded into `phase-1.md`'s sign-in section and `phase-3.md`'s traceback section (they re-use the same scripts) but each carries its own explicit phase tag (`5d-i`/`5d-iii`/`5d-iv`) in its title, so they live here instead — see `setup.md`'s History section for that split.

## User-provided CA, traceback dedup, Problems-entry lifecycle

- [ ] **5.1** **(live) User-provided CA certificate — phase 5d-i** — only on a
  deployment whose chain the OS does *not* already trust (an incomplete chain,
  or a private root not installed locally). First sign in with
  `pythonOnViya.userProvidedCertificates` unset.
  **Expect:** sign-in fails before authentication with a TLS error
  (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `unable to verify the first
  certificate`) in the **Python on Viya** log. Then set the setting to the PEM
  path for the missing authority, reload the window, and sign in again.
  **Expect:** sign-in completes and a run works — the same dedicated agent is
  on both paths. Add a second, bogus path to the array and reload.
  **Expect:** a single **Could not read the CA certificate at …** warning in
  the log, naming that path, and sign-in still works on the good one.

- [x] **5.2** **(live) Traceback is not echoed or mangled after the outcome — phase 5d-iii** —
  re-run the bare recursion from the row above; it is the shape that first
  showed this (Finding 74).

  ```python
  def recurse(n):
      return recurse(n + 1)

  recurse(0)
  ```

  **Expect — output channel:** the raw traceback streams once while the run
  executes; then `Finished with an error.` on its own line with **nothing after
  it**. The `RecursionError: maximum recursion depth exceeded` line is **not**
  repeated below the outcome. (Before 5d-iii it was printed a second time, with
  a stray `>>>` glued onto its end.)

  **Expect — Problems panel and Result panel:** the exception message ends at
  `RecursionError: maximum recursion depth exceeded` with **no trailing `>>>`
  or `...`**. (It may still be _prefixed_ by `[Previous line repeated N more
  times]` — that is pre-existing `parseTraceback` behaviour, not this slice,
  and is genuine traceback content rather than a prompt marker.)

  **Then confirm the lines that must still print** (they never streamed, so the
  dedupe must leave them alone):

  - `import nosuchpkg` → after `Finished with an error.` the output channel
    still shows the `ModuleNotFoundError: …` line **with** the
    `Run "Python on Viya: Show Environment" …` sentence appended. One repeat of
    the exception tail here is expected and accepted.
  - Any SAS-side failure with no Python traceback (`SYSCC` non-zero and not
    `1012` — e.g. `PROC PYTHON` unavailable, or a dead session): its
    `SYSERRORTEXT` message still prints on the line after `Finished with an
    error.`
  - A traceback header with frames but no exception line (hard to force by
    hand; unit-covered): the output channel still shows a final
    `an unhandled Python exception` line.

  **Not this box:** the interpreter banner (`Python 3.x … / Type "help" …`) and
  bare `>>>` markers still appearing in the *live transcript* of a failing run
  are Finding 74's other half, deliberately deferred to a live-Viya probe
  (`phase-5.md` Runbook item 3). Note whether you see them; do not fail this
  item for it.

  **Verified live 2026-09-02** against `verde` with a `.vsix` from
  `phase-5d-iii-finding-74` (PR #92). Ten runs — five scripts × **Run
  Selection** and **Run File**:

  1. bare recursion → output channel ends at `Finished with an error.`;
     structured message `[Previous line repeated 995 more times]
     RecursionError: maximum recursion depth exceeded` — no trailing `>>>`,
     no third copy in an outcome line.
  2. `raise ValueError("boom")` → full dedup: `Finished with an error.` on
     its own, structured message `ValueError: boom`, **no outcome bullet**.
  3. `import nosuchpkg` → the superset case: after `Finished with an
     error.` the channel still prints `ModuleNotFoundError: No module named
     'nosuchpkg' Run "Python on Viya: Show Environment" …`; the structured
     message is Python's own text with no pointer and no `>>>`.
  4. `print(">>> …")` / `print("...")` then `raise` → no over-reach: both
     `print` lines survive verbatim in the stream, message is `RuntimeError:
     done` only.
  5. figure written then `raise` → rich-output capture still runs on the
     failure path; panel shows raw log + structured traceback + PNG +
     `Finished with an error.` with no outcome bullet.
  6. successful run (`print(f"the answer is {x}")`) → `Finished.` alone; no
     traceback block; panel does not reveal for text-only.

  Run Selection and Run File matched on every case. The
  synthesized-fallback / SAS-side-`SYSERRORTEXT` sub-cases were left to unit
  and integration coverage (not hand-forceable). **Sub-finding (a) noise**
  (banner on Run File, `>>>` on every run) was present throughout, as
  expected — see §6's "Hello world streams clean" note for the refined
  characterisation.
- [x] **5.3** **(live) A stranded Problems entry clears on the lifecycle events, not
  only a re-run — phase 5d-iv** — this is about the **Problems** panel
  (**View → Problems**, `Ctrl+Shift+M`), not the Result panel webview, which
  is untouched throughout. Produce a Problems entry as in the row above (run a
  file whose last line is `c = 1 / 0`), confirm the one entry for that file is
  showing, then — one at a time, re-running for a fresh entry before each:
  **(a)** close that file's editor tab (save first if it is dirty) → the
  Problems entry disappears; reopen the file → still gone (no run has
  happened). **(b)** run **Python on Viya: Sign Out** → entry gone. **(c)**
  **Select Run Target → Local Python** → entry gone; switch the target back to
  the Viya profile → still gone. With two profiles configured, switching from
  one Viya profile to another (staying on Viya) leaves the entry in place.
  Implemented in 5d-iv (`src/run/commands.ts` wiring, `RunDiagnostics.clearAll`,
  and `ViyaAuthenticationProvider.onDidSignOut` for (b)). **Verified live
  2026-09-03** against `verde` with a branch `.vsix` (after a window reload) —
  (a), (b) and (c) all clear the entry, the reopen/switch-back cases leave it
  gone, and the viya→viya switch leaves it in place.

