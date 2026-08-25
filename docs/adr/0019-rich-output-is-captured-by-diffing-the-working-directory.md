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
  findings 61–69

> **Amended 2026-08-25 (slice 3c-i, while executing this ADR).** Point 7's
> "fetch each candidate's content" turned out to have a prerequisite this ADR
> did not name: `auth/transport.ts`/`src/compute/client.ts` could not carry a
> binary response body byte-for-byte, or above a 1 MiB cap, before this slice
> extended them. See the amendment at the end of this record and finding 69.
> This does not change the mechanism decided below — only what had to be true
> of the transport underneath it for that mechanism to work at all.

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
   entry's name and its `size` — finding 67 confirms a bare listing item
   carries `size` directly (and `modifiedTimeStamp`, not used here), with no
   properties or content fetch needed to read it, so the before/after diff
   costs exactly one listing request on each side of the run, not one
   request per candidate file. An `ETag`, by contrast, is confirmed present
   only on a `getFileProperties`/content response, never observed on a bare
   listing entry (finding 65) — which is why size, not identity, is this
   slice's comparison key.
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

## Amendment — 2026-08-25 (slice 3c-i): the transport had no way to carry a binary response

Writing `src/compute/files.ts`'s `readFileContent` against point 7 above
surfaced that the shared HTTP transport could not actually do what this
mechanism assumes. `auth/transport.ts`'s `nodeHttpTransport` — the one
transport every `ComputeClient` request goes through — always decoded a
response body with `Buffer.toString("utf8")` and capped it at
`MAX_BODY_BYTES` (1 MiB), independent of what was being fetched. Neither of
those is a wire finding about Viya; both are properties of code this project
had already written, for callers — a token response, a Compute JSON
representation — that were always textual and always small. Finding 61's own
"read the response body directly as bytes" was a true statement about the
*deployment*, probed with `curl` outside this codebase; it was never a claim
about what `client.ts` could do, and nothing before this slice had ever asked
it to carry binary content at all.

The consequence was not hypothetical. `Buffer.toString("utf8")` replaces any
byte sequence that is not valid UTF-8 with U+FFFD, and that replacement
cannot be undone by re-encoding the resulting string — so fetching a real PNG
(finding 61/66's own 23,206- and 262,591-byte figures, both containing
arbitrary compressed bytes in their CRCs and zlib streams) through
`ComputeClient.send` as it stood would have silently corrupted it. Separately,
the 1 MiB cap sits well under this ADR's own 10 MiB rich-output ceiling — a
size finding 66 never had reason to probe, since its largest measured figure
was under 300 KB.

**Fixed as part of this slice, confirmed with the developer before touching a
layer every Compute request shares:**

- `TransportResponse` gained an optional `bytes(): Promise<Uint8Array>`,
  reading the same buffered response `text()` already does — no additional
  network cost, since the whole body is read into memory before either
  accessor is ever called.
- `TransportRequest` and `ComputeRequest` gained an optional `maxBodyBytes`,
  defaulting to the existing 1 MiB cap when a caller does not raise it.
- `ComputeResponse` gained `rawBody`, populated from `bytes()` whenever the
  transport provides one.

Both additions are optional, so every existing `TransportResponse` built by a
test before this slice — none of which construct a `bytes()` method — keeps
compiling and keeps exercising the "no raw bytes available" path unchanged.
No existing caller's behaviour changes: the 1 MiB default is untouched for
every request that does not explicitly override it. `rawBody` is, in fact,
populated on every request the real transport answers — `sendRequest` reads
`bytes()` once before it branches on status, so it is present (typically
zero-length) even on a 304 — but every existing caller keeps reading `body`/
`text` unchanged and never looks at it, which is the sense in which nothing
about them changes. `files.ts`'s `readFileContent` is, today, the only caller
that sets `maxBodyBytes` or reads `rawBody`, passing `richOutput.ts`'s
`MAX_CAPTURE_BYTES` (10 MiB) through.

**This does not reopen this ADR's own decision.** The mechanism — diff, then
whitelist, then order, then cap, then decode — is exactly as decided above.
What changed is a fact about the layer underneath it: that a byte-perfect
fetch was actually possible through this project's own client, which turned
out not to be true until this slice made it true. See finding 69
(`docs/phases/phase-3.md`) for the full account, including what this
amendment does not settle (a distinguishable failure for a transport that
predates `bytes()`, which no transport in this codebase is).
