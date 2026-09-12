<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — miscellaneous (phase-agnostic)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend. Everything here applies to every build, regardless of which phases have landed — run it on every full pass.

## Trust, enablement and the rest

- [x] **M.1** **Untrusted workspace posture** — set the folder Restricted via
  **Workspaces: Manage Workspace Trust**.
  **Expect:** editing, syntax, and profile add/edit/delete still work;
  **Connect** and **Run File** are refused with a pointer to Manage Workspace
  Trust; `pythonOnViya.connectionProfiles` and `pythonOnViya.defaultProfile`
  show as restricted in Settings.
- [x] **M.2** **Command enablement tracks state** — watch the palette across connect /
  disconnect / a run in flight.
  **Expect:** _Connect_ disappears once connected; _Disconnect_ only while
  connected; _Cancel_ only while a run is in flight. Confirmed for this
  ordinary connect/disconnect cycle. **Not covered by this item:** the
  sign-out/idle-reap/reload edge cases where Connect gets stuck hidden even
  though nothing is actually connected — see §3/§4 above and Phase 3's **3f**
  slice.
- [x] **M.3** **(live) Sign out while connected** — with a live session, run **Sign
  Out**.
  **Expect:** the session is dropped; the next run re-authenticates cleanly.
  **Failed, 2026-08-27** — same defect as §3's Sign Out item: re-authentication
  never happens automatically. Tracked in Phase 3's **3f** slice; don't
  double-count against §3.
- [x] **M.4** **Failures are diagnosable** — on any error path, open **Show Log**.
  **Expect:** it names the request, the deployment's own wording, a status code,
  and a correlation id. **Failed, 2026-08-27** — Python-level errors (a
  traceback) are diagnosable, but most *extension*-level failures ("could not
  be sent to SAS Viya…") produce nothing in the log at all. Root cause: three
  failure paths in `src/run/commands.ts` never call `log.*` before showing
  that message. Tracked in Phase 3's **3f** slice.


## Regression spot-checks

Each of these was a real defect caught in review. Quick to confirm now that you
are set up.

- [x] **M.5** **(live) Runs actually produce output** — any successful **Run File**
  shows its stdout.
  **Expect:** output appears. A run that reports success but shows nothing has
  regressed the `infile=` step-close fix (finding 70): the job can report
  `completed` with nothing flushed unless the step is closed.
- [x] **M.6** **(live) Cancel is scoped to what it actually started, not to "the active
  profile"** — a *separate VS Code window* cannot reach another window's
  in-flight run at all (each window is its own extension host with no shared
  `currentRun`/`currentReset` state), so that repro can never exercise this
  item. Instead: connect on profile A in **one window**, start a 60-second
  run, then use **Select Run Target** to switch that **same window** to
  profile B mid-run, and invoke **Cancel**.
  **Expect:** A's run keeps going — Cancel acts on the backend it actually
  started the run against, not on whatever profile is active now. *(The
  2026-08-27 pass used the two-window repro this item used to describe, which
  can't test the real invariant — code-traced as correct
  (`src/run/commands.ts`'s `currentRun`/`currentReset` tracking, from PR #63),
  but re-run with the same-window repro above before ticking this box.)*
- [x] **M.7** **(live) Backend re-connects after a reset** — run **Reset Python State**,
  then immediately **Run File** on the same profile.
  **Expect:** the run works — the per-profile backend cache re-calls the
  idempotent `connect()` before handing a cached backend back out.
- [x] **M.8** **(live) Panel re-reveal and probe resilience** — confirmed in §8
  (re-reveal) and §9 (broken-metadata tolerance); tick here once both hold.

