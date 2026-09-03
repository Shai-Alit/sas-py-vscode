# Between-phase housekeeping

The goal of this document is to keep the project clean and current in its
documentation, planning, and testing.

Between each major phase — after the last slice of phase N lands, and before
work starts on phase N+1 — a thorough review is completed so that past work is
properly documented, issues were addressed, and testing was finished. It also
ensures the next phase is properly scoped and planned, taking into account any
changes made as a result of building the previous one.

**When this is due:** `STATUS.md` is opened at the start of every session and
names the current phase. When it shows the last slice of a phase merged, this
checkpoint is due before any phase N+1 work begins. Raise it then rather than
waiting to be asked.

## Review process

Complete a thorough review of progress and confirm each of the following.

1. ADRs are correct.

2. Punch-list items — the current phase's Runbook section in
   `docs/phases/phase-N.md` — are either completed, or carry a note saying why
   not and when they are expected to be.

3. The runbook and project plan are fully up to date: both the cross-cutting
   core (`RUNBOOK.md`, `PRODUCTION_PLAN.md`) and the completed phase's file
   under `docs/phases/`.

4. `STATUS.md` names the phase actually being started next, and its phase-index
   table reflects the phase just completed. This is the one file every session
   opens first, so a stale entry here silently misdirects every session until
   someone catches it.

5. Any project-folder scratch or pending file created under CLAUDE.md's
   Runbook-hold policy (for example `phase-N-runbook-pending.md`) is
   reconciled. That means specifically:

   - Confirm each held item was actually applied to the real phase file. Check
     the file itself — do not take a prior note's word for it.
   - Fold in anything not yet applied.
   - Then either retire the scratch file's holding role, or trim it down to
     only the cross-cutting items that are genuinely still open, stated
     explicitly as such.

6. All relevant manual tests have been completed. If any have not, document
   why they are being skipped.

7. Dependency advisories are current. Check the GitHub Dependabot alerts
   against `scripts/advisory-allowlist.json`, and check whether any `expires`
   date in that file falls before the next phase is likely to finish. An entry
   near expiry gets re-reasoned now — is the advisory fixed upstream, is the
   path still unreachable, does it warrant a new date — rather than failing CI
   mid-slice. Any *production*-tree advisory is a release decision, not a
   housekeeping item: surface it immediately rather than deferring it to this
   checkpoint.

### Honest assessment

Make every effort to assess documentation, code, and findings honestly. Note
where there may be questions, and don't be afraid to call out mistakes so they
can be verified and rectified. If there are open questions that need a human
look or interpretation, ask — but best judgement is welcome where it applies.

### Agents

This is a good process in which to create and run several agents in parallel,
so everything is captured efficiently and thoroughly. Cross-reference their
results against each other once they complete.

### Up-to-date information

Use the web search connector, and probe the live Viya deployment, rather than
relying on recall. CLAUDE.md's "Don't guess about Viya — probe it" governs when
and how; this checkpoint is a common place for an unprobed assumption from the
finished phase to surface. Include citations where they matter.

### Testing

Two separate assessments:

1. Were the manual, human-in-the-loop tests that were needed actually
   completed, and their results documented? If a test did not run, call it out
   — unless the previous phase already documented that it would be skipped.

2. Are any new manual, human-in-the-loop tests needed for better coverage? Show
   clearly where and why. Concluding that none are needed is an acceptable
   outcome.

## Procedure and output

Lay every finding out as a bulleted or numbered list rather than a single large
paragraph, so it is easy to read and act on. That applies to all three steps
below.

1. Give the findings in chat first.

2. Inventory first, then procedure once the human confirms. To be clear: this
   is not a recommendation that there *must* be more tests. It is that any test
   which was needed and didn't run, or which ought to be added, must be
   documented. Once that inventory is reviewed, the human decides which to run.

3. Provide recommendations on the next action, performing whatever API probes
   and web searches are needed to be confident the conclusions are correct and
   current.
