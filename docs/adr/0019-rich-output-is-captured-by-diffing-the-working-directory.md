# ADR-0019 — Rich output is captured by diffing the session's working directory

- **Status:** Accepted
- **Date:** 2026-08-25
- **Decides:** how `RichOutput`'s `image/png` and `text/html` arms get filled
  for a `PROC PYTHON` run — what counts as "output worth capturing", when it
  is looked for, and how it is fetched and cleaned up
- **Constrained by:** ADR-0014 (`Program.bytes` reaches the interpreter
  unmodified — nothing may wrap or inject code around a user's own script),
  ADR-0015 (the `ExecutionBackend` seam and `RichOutput`'s contract), ADR-0009
  (coverage-scope discipline), ADR-0010 (link-following discipline)
- **Executed in:** slice `3c-i`
- **Evidence:** `docs/phases/phase-3.md`'s 2026-08-25 probe-findings section,
  findings 61–66

## Context

3c's own punch list asked one question — can a matplotlib figure or a
DataFrame's HTML repr be gotten out of `PROC PYTHON` at all — and the probe
answered it: yes, by writing the file to the session's own working directory
from Python and reading it back through the Compute service's `getFiles` →
`getDirectoryMembers` → `getFile` link chain (finding 61), byte-perfect from
393 bytes to 262,591 (finding 66), with cleanup as `DELETE` plus `If-Match`
off a properties `GET`'s `ETag` header (finding 65). What the probe's script
did not have to answer, because it wrote to a filename it chose and knew in
advance, is the question this slice actually has to settle: **given an
arbitrary user script, how does the backend know which files, if any, it
just produced are worth surfacing as output?**

Two shapes were considered.

An **explicit helper library** — the extension makes a small importable
module available on the session (e.g. `from python_on_viya import show`),
and the user's own script calls it to register output — would remove all
ambiguity about intent, at the cost of requiring users to adopt a new API
before anything appears, and of not helping a script someone already wrote
without it. It also does not fit this phase's model: 3c/3d run a plain `.py`
file top to bottom, once, with no REPL and no notion of "the last
expression's value" the way a notebook kernel has — Phase 9 owns that model,
not this one — so there is no existing hook this slice could extend, only a
new one it would have to invent.

A **passive directory diff** — snapshot the working directory immediately
before a run, snapshot it again after, and treat anything new or changed as
a candidate — asks nothing of the user beyond what they already do to save a
plot or a table (`fig.savefig(...)`, `df.to_html(...)`) to a file, which is
exactly what finding 61's probe script did. It cannot distinguish an
intentional output from an incidental one (a script that writes a `.png`
for its own bookkeeping reasons gets it captured too), but that ambiguity is
the same one already accepted for `print()`: this backend does not know a
call's intent there either, it shows what was written and lets the user
be selective. **Chosen**, confirmed with Sean 2026-08-25.

## Decision

**Snapshot, run, snapshot, diff, capture, clean up — once per `execute()`
call.**

1. **Before** the job is created, list the session's working directory
   (`src/compute/files.ts`, new — owns `getFiles` → `getDirectoryMembers` and
   nothing upstream of ADR-0010's link-following discipline). Record each
   entry's name and whatever identifies its content — size is sufficient;
   an `ETag` is not guaranteed present on every listing entry the way it is
   on a `getFileProperties`/content response (finding 65 only measured the
   latter), so size is the comparison this slice relies on, not identity.
2. Run the job exactly as `procPython.ts` already does.
3. **After** the job settles — **and only if it did not end `cancelled`** —
   list the directory again.
4. **Diff, in `src/backend/richOutput.ts` (new, pure, no `vscode` — same
   discipline as `logFilter.ts`):** a candidate is any entry present after
   that is either absent before, or present before with a different size.
   Same-name-same-size is not a candidate, even if the file was in fact
   rewritten with identical-length content — indistinguishable from
   "unchanged" with the information this slice reads, and not worth a
   second listing call to resolve.
5. **Filter to a closed, small whitelist by extension**: `.png` →
   `image/png`, `.html`/`.htm` → `text/html`. Nothing else is captured in
   this slice — not `.jpg`, not `.svg`, not `.csv` — because those are not
   arms `RichOutput` has today (`backend.ts`), and adding one is a decision
   for whichever slice adds the arm, not an incidental side effect of this
   one recognising an extension nobody asked it to.
6. **Order candidates by filename, ascending.** There is no ordering signal
   in a directory listing this slice can rely on being stable or meaningful
   (the underlying filesystem gives none), and a user with more than one
   plot in a script controls the order the only way this design can honour:
   by naming the files themselves.
7. **Fetch each candidate's content** (`files.ts`), base64-encode a `.png`'s
   bytes for `RichOutput.image/png`'s contract, decode a `.html`/`.htm`
   file's bytes as UTF-8 text for `text/html`. **A file larger than 10 MiB
   is skipped, not fetched** — ten megabytes is roughly forty times the
   largest size finding 66 actually measured (262,591 bytes), generous
   headroom for a real figure while still catching a runaway or accidental
   write before it is read fully into the extension host's memory and
   base64-inflated by a third on top. No probe evidence motivates 10 MiB
   specifically; it is a stated, changeable choice, not a measured limit.
8. **A candidate that cannot be fetched or exceeds the size cap is skipped,
   not fatal.** The run's own outcome (§`SYSCC`, per ADR-0014) is unaffected;
   a plain `text/plain` note is pushed to the output relay in its place,
   naming the file and the reason, so the gap is visible rather than silent.
   This is the same "best-effort, report honestly" shape `readSyscc` already
   uses for `SYSERRORTEXT`.
9. **Every candidate actually captured is deleted afterward** (`DELETE` with
   `If-Match` off a properties `GET`'s `ETag`, finding 65), so a session that
   outlives many runs in one editing sitting does not accumulate every plot
   its user ever made. **A failed deletion is logged, not surfaced or
   retried** — the same shape `close()`'s `onBackgroundFailure` already
   gives a cancellation that could not be acted on — because a leaked file
   is a much smaller problem than failing an otherwise-successful run over
   its own cleanup step.
10. **A skipped file is never deleted.** Only a capture this backend
    actually read and decoded is assumed safe to discard; one it declined
    (too large, unfetchable) is left for the user to find, since this
    backend never confirmed what it contains.

**Capture happens on both a successful and a failed run, never on a
cancelled one.** A script that raises partway through may already have
written a plot before the exception — the same reasoning that keeps a
partial `print()` log visible on failure applies here, and nothing about
`SYSCC` being non-zero says the files on disk are less real. A cancelled
run settles with **no `ExecutionOutcome` at all** (ADR-0015) and its files,
if any, may correspond to a script `PROC PYTHON` had not finished
transferring or running — capturing them would attach output to a run this
seam does not represent as having produced one, so this slice does not try.

## Alternatives considered

**The explicit helper library**, covered in Context. Not rejected as wrong,
rejected as belonging to a different execution model (a REPL/notebook
kernel) this phase does not have and Phase 9 may.

**Diffing by `ETag` instead of size.** Rejected for this slice on the
evidence available: finding 65 measured an `ETag` on a `getFileProperties`
GET and on a content-fetch response, never on a bare `getDirectoryMembers`
listing entry — using it as the diff key would mean a properties `GET` per
entry, per snapshot, which is one request per existing file in the directory
twice over, to catch a same-size rewrite this slice has already decided not
to chase (see point 4 above).

**No size cap.** Rejected: finding 66 is one data point at 262,591 bytes,
not a ceiling, and shipping with no bound at all means the first user who
saves a large enough array plot finds out what "too large" means by
watching the extension host's memory grow instead of by reading a skipped-
file note.

## Consequences

**Nothing here makes a plain script "just work" the way a notebook cell
does.** A user has to know that saving a `.png` or `.html` file is how
output other than `print()` gets shown — that is a real, user-facing gap
this slice does not close, and it is `docs/`'s job to say so plainly rather
than let a user discover it by writing `plt.show()` and seeing nothing,
since `PROC PYTHON`'s Python has no display to show anything on.

**A same-size overwrite is invisible.** Recorded above as the accepted cost
of not spending a second listing call per file on every run to resolve it.

**The whitelist is closed on purpose and will need revisiting.** `.jpg`,
`.svg`, `.pdf` and tabular formats are all plausible things a script might
want to show and none of them are captured by this slice, because none of
them are `RichOutput` arms yet. Widening the whitelist without widening
`RichOutput` first would capture bytes this seam has nowhere to put.

**Viya 3.5 is unverified for every part of this**, same as everything else
in this project until it is actually probed against one.
