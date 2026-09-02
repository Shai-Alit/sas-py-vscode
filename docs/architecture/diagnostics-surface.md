<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Traceback mapping and the diagnostics surface

When a Python run on Viya raises, three things want to say where: the output
channel (already does, as plain text), the **Problems panel**, and the
**result panel** (a clickable frame that jumps to the editor). The last two
need a traceback line number turned into an editor position. That mapping is
one small pure module; the two surfaces that consume it are the rest of this
page.

Phases: the mapping is 4c, the surfaces are 4d. They are documented together
because neither half is legible without the other.

## The mapping — `src/backend/tracebackDiagnostics.ts`

Pure, no `vscode` import (ADR-0009's coverage rule — it stays in the
denominator), and small enough to state in full:

- **`mapFrameToOrigin(frame, origin)`** returns a zero-based
  `{ line, character }` for a frame whose `file` is `<string>`, and
  `undefined` for anything else. The arithmetic is
  `origin.lineOffset + frame.line - 1`: `frame.line` is one-based as Python
  prints it, `lineOffset` is the zero-based editor line the uploaded bytes
  began at (0 for a whole file, `selection.start.line` for Run Selection).
  There is nothing else to subtract —
  [ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md)
  established that `PROC PYTHON infile=<fileref>` runs the file byte-for-byte
  with no wrapper preamble, so a `<string>` frame's line number is the
  *identity* against the file that was uploaded.
- **`primaryFrame(traceback)`** scans the stack innermost-first for the first
  `<string>` frame — skipping a trailing user-generated `<stdin>` frame (from
  the user's own `compile(src, "<stdin>", "exec")`), which is real but
  unmappable. `undefined` when no frame in the stack is in the user's file at
  all.
- **`primaryPosition`** is the two composed: the position one `Diagnostic`
  goes at.
- **`withModuleNotFoundGuidance(message)`** appends one sentence pointing at
  `Python on Viya: Show Environment` when the message starts
  `ModuleNotFoundError:` — the ask 3e left for this phase. `procPython.ts`'s
  `buildFailureOutcome` calls it while composing the diagnostic message, so
  everything downstream (the output channel, the Problems panel) inherits it
  for free.

### Why `character` is always 0

`PROC PYTHON`'s traceback carries only a line number — `  File "<name>",
line <n>, in <name>`, finding 39's one measured shape. There is no column to
report, so every position starts at the beginning of its line.

### Why non-`<string>` frames are left alone

A frame the runtime labels `<stdin>` can appear below a real frame when the
user's own code built a code object that way; a frame with an absolute path
is library code on a machine the user cannot log into. Neither has a position
in the user's own file, and this project keeps no offset map for text a
program constructed at run time. `mapFrameToOrigin` returns `undefined` for
them rather than guessing — "a guessed position would be worse than leaving
it unmapped" is the rule the rest of this page is built on.

## Surface 1 — the Problems panel (`src/run/diagnostics.ts`)

`RunDiagnostics` is a thin `vscode` shell around one
`languages.createDiagnosticCollection("pythonOnViya")` — the same shape
`RunOutputChannel` and `ResultPanel` already take around their own `vscode`
singletons, and on `.c8rc.json`'s exclude list for the same reason. Two
methods, both called from `commands.ts`'s `runNow`:

- **`clearFor(uri)`** — `collection.delete(uri)`, at the start of *every* run
  (success or failure), keyed on `program.origin.uri`. A run that now passes,
  or fails before producing a traceback, leaves nothing stale behind.
- **`publish(origin, traceback, message)`** — one `Diagnostic` at
  `primaryPosition`, `severity: Error`, `source: "Python on Viya"`,
  `relatedInformation` listing every `<string>` frame (outermost first) as a
  `Location` back in `origin.uri`. `message` is the run outcome's own
  `diagnostics[0].message`, so the `ModuleNotFoundError` suffix rides along.

`publish` is a **no-op when `primaryPosition` is `undefined`** — a SAS-side
failure (`SYSCC=3000`, no Python frames) or a stack with no `<string>` frame
anywhere. This phase's exit criterion is an *accurately*-positioned error;
the output channel and result panel already carry the message unpositioned,
and the Problems panel is the surface that would be lying if it pointed at
line 0. `relatedInformation` is also omitted for a single-frame error — its
one entry would just repeat the diagnostic's own location.

### How the traceback reaches `runNow`

`ExecutionOutcome` carries `diagnostics` but not the structured `Traceback` —
that travels as the trailing `application/vnd.python.traceback` `RichOutput`
`procPython.ts` pushes onto the stream before `handle.done` settles.
`drainOutputs` (in `commands.ts`) captures it while forwarding outputs to the
channel and panel, and returns it through the `withProgress` callback;
`runNow` publishes from it only on `settled.ok && !settled.value.succeeded`.

## Surface 2 — the result panel's clickable frames

The panel already rendered a traceback as a heading, a message and a list of
frame lines ([ADR-0021](../adr/0021-result-panel-webview.md)). 4d makes the
frames from the user's own file interactive without touching the CSP or
adding a webview surface.

- **`resultPanelModel.ts`** — the traceback `RenderItem` gains
  `frames: RenderTracebackFrame[]` (raw `file`/`line`/`name`, same order as
  the pre-formatted `frameLines`). Not user-facing text — the DOM layer keys
  on `file`, the host maps by index.
- **`resultPanelDom.ts`** — `DomPort` gains `onActivate(el, handler)`.
  `applyMessage` takes an optional `onFrameActivate(frameIndex)` callback; a
  frame `<li>` becomes a `role="button"`, `tabindex="0"` button wired to it
  **iff** its `file` is `<string>` and that callback was supplied. Still no
  `vscode` and no DOM types — the port is this module's own interface.
- **`src/webview/entry.ts`** — the real `onActivate` wires a `click` and a
  keyboard (`Enter`/`Space`) listener; the supplied `onFrameActivate` posts
  `{ type: "revealFrame", frameIndex }`.
- **`resultPanel.ts`** — retains the run's `ProgramOrigin` (`startRun(origin)`)
  and the streamed structured frames, validates the inbound message with
  `isRevealFrameMessage`, resolves `frames[frameIndex]` through
  `mapFrameToOrigin`, and opens the editor via an injectable `revealPosition`
  dep (defaults to `window.showTextDocument` with the mapped selection). A
  stale index, a non-`<string>` frame, or a run started without an origin is
  a silent no-op.

### The message protocol stays host-authored

`ResultPanelMessage` is still host→webview only; `RevealFrameMessage` is its
own type with its own guard, the one thing the webview says back beyond the
`"ready"` handshake. ADR-0021 already named "jumping from a traceback frame
to the editor" as the exception it left for Phase 4, so this is that
exception landing, not a new direction of travel opening up.

## What is deliberately not here

"Optional quick actions" on the diagnostic (an *Install package* code action
for `ModuleNotFoundError`, say) stayed time-boxed and uncommitted for 4d.
Column information — a `Diagnostic` range that highlights the offending
expression rather than the whole line — would need `PROC PYTHON` to report a
column, which finding 39 says it does not.

Two lifecycle gaps are deferred to Phase 5 (see `phase-4.md`'s 4d entry):
the `DiagnosticCollection` is only cleared by the next run of the same file,
never on document close / sign-out / a switch to Local; and
`RevealFrameMessage` carries no per-run token, so a `revealFrame` for a
stale run's frame that outraces the host queue past the next run's own
traceback resolves against the wrong run's origin. Both are low-stakes (a
diagnostic left where the last run raised; a jump to a line in the same
file) and a per-run token closes the second one.
