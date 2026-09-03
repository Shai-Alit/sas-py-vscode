# sas-py-vscode — Implementation Plan

**Goal.** A production-quality VS Code extension that lets a developer write
Python locally and run it on SAS Viya, using the Python packages installed and
managed *within* Viya — the same relationship the SAS extension provides for SAS
code. Viya becomes the test or production runtime for Python.

**Long-term target: feature parity with the SAS VS Code extension**, for Python.
Ideally the only difference a user notices is the language. Parity is tracked as
an explicit gap analysis in §3.1 — including the handful of areas where we intend
to *exceed* the SAS extension (CAS/SWAT access, environment awareness, notebook
format) and the ones we deliberately won't match (SSH/COM/IOM, SAS Studio flows,
SAS 9). v0.1.0 is intentionally far short of parity; §8 says why.

**Explicitly out of scope.** SAS 9 support in any form; local Python execution;
replacing `ms-python.python` / Pylance for editing intelligence; authoring SAS
code (that is the SAS extension's job — the two are complementary and expected
to be installed side by side).

**Non-negotiable constraints** (from the project brief):

- No local Python packages required. Ideally no local Python at all. If some
  local dependency proves unavoidable, it must be the bare minimum and must be
  justified in writing here before it lands.
- Full suite of software tests, built alongside the code, not retrofitted.
- Targets Viya 4 only. Version differences within Viya 4 are absorbed at a
  seam rather than branched inline — the seam this constraint asks for is the
  same one a real second generation would need, and stays that shape.

> **Amended 2026-09-03 by [ADR-0022](docs/adr/0022-drop-viya-35-support.md).**
> This bullet originally read "Viya 3.5 and Viya 4 both handled"; architectural
> Viya 3.5 support is dropped — too few customers, no deployment ever reachable
> to verify any of it against, and no path in sight to getting one. Edited in
> place, rather than left as a superseded original with a note below, because
> an AI reviewer instructed to enforce this file's constraints verbatim has no
> way to weigh a trailing amendment against the bullet it amends — see §1.4 for
> the fuller record.

---

## 1. Current-state assessment

### 1.1 What exists today

| Asset | State |
|---|---|
| `Shai-Alit/sas-py-vscode` | Empty repo — `LICENSE` (**MIT**) and one initial commit. Everything below is greenfield. |
| `sassoftware/vscode-sas-extension` (cloned locally) | v1.20.0, **Apache-2.0**, the reference architecture. Substantial reuse is legally permitted with attribution and preserved copyright headers. |
| Live Viya 4 deployment | Available and probed. See `PROBE-FINDINGS.md`. |
| Viya 3.5 deployment | **None available.** This shaped the entire 3.5 strategy (§1.4) until [ADR-0022](docs/adr/0022-drop-viya-35-support.md) dropped 3.5 support, 2026-09-03. |
| `viyapy` | The process template — phased plan, slice-per-PR, dialect layer, contracts, dual AI review. Conventions are inherited wholesale. |

> **✅ Licensing — settled 2026-08-11 (open decision #0, §6). The repo relicenses
> to Apache-2.0 in slice 0a.**
> It was MIT; the code we port is Apache-2.0. Shipping an Apache-2.0-derived
> bundle under a bare MIT licence would drop obligations we don't get to drop: the
> §4(b) `NOTICE` requirement, the §4(b) requirement to mark modified files as
> changed, and the §3 patent grant and termination terms. Matching upstream
> removes the conflict entirely and gives our own users the same explicit patent
> grant — worth having when the code interoperates with a commercial vendor's
> product. Slice 0a therefore replaces `LICENSE`, adds a `NOTICE` recording
> upstream attribution, and every ported file must both preserve its SAS header
> **and** carry a modified-file notice. Rationale recorded in ADR-0000.

### 1.2 The central technical question, and its answer

*How do you run Python on Viya at all?* Probing settled this (`PROBE-FINDINGS.md`):
`PROC PYTHON` inside a Compute session executes against the sas-pyconfig managed
interpreter (Python 3.12.12, with pandas/numpy/swat present), **retains Python
state across steps**, exposes the `SAS` bridge object, returns real tracebacks
whose `<string>` frames map 1:1 onto submitted lines, and signals failure via
`SYSCC`.

That last set of properties is what makes this project tractable. State
persistence in particular means notebook and REPL semantics — normally the thing
that forces a bespoke kernel — come free from the compute session. So the
execution substrate is the *same* Compute REST plumbing the SAS extension
already drives, and most of that extension's **connection substrate** transfers.
(Its larger UI surfaces transfer too, but those are Phases 6–7 — after v0.1.0,
and not part of the first useful build.)

### 1.3 What transfers from the SAS extension, and what does not

**Transfers with light adaptation** — OAuth2 + PKCE auth (`connection/rest/auth.ts`),
the `AuthenticationProvider` and per-profile SecretStorage token handling, the
`Session` abstract base (template-method pattern), the HATEOAS `Compute` link
layer, `ComputeSession`/`ComputeJob` including the long-poll log-stream
generators, connection profiles, the self-signed-certificate helper, the
generated Compute/Files/Folders OpenAPI clients, the content and library
explorers (they browse files and tables — language-agnostic), and the whole
build/CI/packaging toolchain.

**Must be written fresh** — the result model (ODS `{html5}` is wrong for Python,
which produces stdout, tracebacks, figures, and DataFrames), the log-to-output
filter (§1.5), traceback→diagnostic mapping, CAS/SWAT integration (the SAS
extension calls **no** CAS APIs at all), and Viya Python environment awareness.

**Dropped entirely** — SSH, COM/IOM, SAS Studio flow conversion, the SAS
language server, syntaxes, themes, snippets.

> **Three of these did not transfer — settled across 2a and 2c.** The list above
> is the estimate made before any of the compute layer was written, and Phase 2
> contradicted it in three places. (i) The **generated Compute/Files/Folders
> OpenAPI clients** were not taken: nothing is vendored, and the client is hand
> written against the links the service sends. Upstream's generated
> `compute.ts` is 20,348 lines of URL builders for an API we navigate by `rel`,
> and it would have to be re-generated and re-audited to be trusted.
> [ADR-0010](docs/adr/0010-compute-client-is-hand-written.md) records it.
> (ii) The **`Session` abstract base** was not taken either: there is no
> template-method hierarchy here, because the seam that matters is the execution
> backend, not the connection type. [ADR-0015](docs/adr/0015-the-execution-backend-seam.md).
> (iii) The **long-poll log-stream generators** were rejected outright. The log
> is drained by a self-driving pump with an explicit cursor rather than an
> `async function*`, because a generator that is not being pulled stops polling,
> and the reason the log stalls has to be visible in the code rather than in the
> consumer's loop. [ADR-0017](docs/adr/0017-the-log-stream-is-a-self-driving-pump.md).
>
> What *did* transfer, and still stands: the OAuth2 + PKCE shape, the
> `AuthenticationProvider` and per-profile SecretStorage handling, the idea of
> navigating Compute by links, connection profiles, and the build and packaging
> toolchain. The certificate helper transferred as a decision to write it
> differently — see the audit note under 1c.

### 1.4 Supported Viya versions — the honest position

Viya 4 is date-versioned and continuously moving; this project targets it
exclusively.

**Decision: Viya 4 only, with release differences absorbed at a
dialect/capability seam rather than branched inline.** The seam exists for
differences within Viya 4 — an old release with no built-in `vscode` client
versus a modern one, for example — not for a second generation, since none is
supported. The capability probe (§2.3) is designed to degrade gracefully and
tell the user plainly if a capability the extension needs is absent.

> **Amended 2026-09-03 by [ADR-0022](docs/adr/0022-drop-viya-35-support.md).**
> This section originally described Viya 3.5 as in scope: "Viya 3.5 is a frozen
> on-prem generation in Standard Support to 2027-10-01 ... The brief requires
> both," with a decision recorded as "architectural first-class support,
> empirically unverified" — a dialect/capability seam so 3.5 was properly
> represented in the design, and a 3.5 test tier as a permanently-skipped
> scaffold until an instance existed. The scaffold never got filled — no Viya
> 3.5 deployment was ever reachable by this project, across every phase from 0
> through 5b — and very few Viya 3.5 customers remain in the target audience.
> Rather than continue carrying a permanently-unverified generation
> indefinitely, 3.5 support is dropped:
> `DialectId` is `"viya4"` alone, `src/dialects/viya35.ts` and
> `contracts/viya35.yaml` are removed, and the "considered absence of a cadence
> version" signal that used to identify Viya 3.5 (§2.3 below) now resolves to
> the same assumed-Viya-4 outcome as an unreadable probe. The dialect/capability
> seam itself is unchanged and unreconsidered — see ADR-0022 for the full
> record, including why a future second generation is unaffected by this.

### 1.5 Known-hard problems, identified up front

These are the parts that will consume disproportionate effort. Naming them now
prevents them being discovered as "small" tasks mid-phase.

1. **Submitted-code escaping — a correctness *and* security problem.** We wrap user
   Python in `proc python; submit; … endsubmit; run;`. Any user code containing the
   token `endsubmit;` — even inside a string or comment — terminates the block
   early and the remainder is interpreted as **SAS**. `&` and `%` may additionally
   trigger SAS macro resolution inside the block. That is both a bug and an
   injection path from Python source into SAS. The injection-free alternative is
   to upload the code to the session filesystem and run it from there instead of
   inlining it; that is likely the right answer and must be probed before 3a is
   written.

   > **Settled 2026-08-16 by 2-pre (findings 31–35).** Confirmed, and the option
   > is **`INFILE=`**, not `FILE=` — `proc python file=…` is not valid syntax, and
   > `ERROR 22-322` enumerates the real set (`COMMAND, ECHO, INFILE, RESTART, SRC,
   > TERMINATE, TIMEOUT`). So the mechanism is upload plus
   > `proc python infile=<fileref>;`. Two corrections to the paragraph above: a
   > stray `endsubmit;` terminates the block *even inside a triple-quoted string*,
   > and `&`/`%` do **not** trigger macro resolution inside an intact block. The
   > danger is therefore narrower than feared and worse than feared — the
   > truncated block poisons the tokeniser, and the next job in that session
   > reports `completed` while executing nothing.

   **Quoting is the sharp edge of this, and it is sharper than it looks.** SAS
   tokenises before it ever hands the block to Python, and its string rules are
   not Python's:

   - **A quote opens a string that runs to the next matching quote, across
     newlines.** Python code with an odd number of `'` characters — an apostrophe
     in a comment, `don't` inside a docstring, `s = "it's"` — can leave the SAS
     tokeniser inside an unterminated literal, at which point it consumes the rest
     of the submitted block *and the statements after it*. The classic symptom is
     a session that stops responding to everything sent afterwards until it is fed
     the `*';*";*/;quit;run;` recovery incantation, which is a thing that exists
     precisely because this happens to people.
   - **Single and double quotes are not interchangeable to SAS.** Macro triggers
     (`&name`, `%macro`) resolve inside double quotes and are left alone inside
     single quotes. Python is indifferent to the choice; SAS is not. So the same
     Python program can behave differently depending on which quote style the user
     happened to type, and that difference is invisible in the editor.
   - **Python's quoting has forms SAS has never heard of**: triple-quoted strings,
     f-strings with nested quotes and braces, raw strings, `\'` escapes (SAS
     escapes a quote by *doubling* it, exactly as the Compute filter does — see
     finding 15 — so a backslash escape is not one), and byte strings.
   - **Doubling is not a general fix.** Doubling quotes to survive SAS tokenisation
     changes the *Python* source unless it is undone at exactly the right layer,
     and "undone at exactly the right layer" is where a hand-rolled escaper quietly
     corrupts a program instead of failing it.

   The conclusion this drives is not "write a careful escaper". It is that the
   submission path needs a **fidelity corpus** (§4) — real Python programs, chosen
   to be hostile to SAS tokenisation, asserted to arrive at the interpreter byte
   for byte — and that any submission mechanism which cannot pass that corpus is
   the wrong mechanism. Running an uploaded file is favoured for exactly this
   reason: a file transfer has no tokeniser in the middle of it.

   > **Settled 2026-08-16 by 2-pre.** It is `proc python infile=<fileref>;`, and
   > the reason held up: the file's contents are not tokenised, there is no source
   > echo, and inlining failed the corpus's central case. The corpus still ships in
   > 3a; what it now proves is upload fidelity rather than an escaper.
2. **Log hygiene.** The Compute log is a *SAS* log: numbered source echo, page-break
   headers, `>>>` REPL markers, procedure timing NOTEs. Turning it into clean
   Python stdout is real parsing work, not a pass-through.

   > **Reduced 2026-08-17 by 2c-pre.** Less parsing than feared: lines arrive
   > *typed* (`source`, `note`, `normal`, `error`), so the filter switches on
   > `type` rather than matching prefixes, and `infile=` submission should mean
   > no source echo to strip at all. `note` is a catch-all including blank
   > lines, which is the trap — see the 3b amendment.
3. **Rich output.** `print` works; matplotlib figures and DataFrame HTML have no
   confirmed return path yet. This is the single biggest unknown and gets a
   dedicated probe slice (3c) *before* any rendering code is written.
4. **Traceback mapping.** Cheaper than the SAS equivalent because `<string>`
   frames map 1:1, but still needs an offset map for injected wrapper lines, and
   must filter the `<stdin>` harness frames.
5. **Cancellation.** Whether a long-running Python step honours compute job
   cancellation promptly is unverified.
6. **Run semantics against a sticky namespace.** State persistence (§1.2) is a win
   for notebooks and a hazard for "Run file": running the same file twice does
   *not* start from a clean interpreter, so stale names and monkeypatched modules
   silently change results and reproducibility breaks. We must decide whether Run
   File resets the namespace by default, and how state is reset *without* killing
   the compute session — which the probe did not establish.
   > **Half settled 2026-08-16 (finding 38).** The *mechanism* is known:
   > `proc python restart;` clears the interpreter in about 3.4 s and leaves the
   > compute session, its libraries and its filerefs untouched, and it composes
   > with `infile=` in a single statement. The *policy* — whether Run File resets
   > by default — is still open and belongs to 3a.
7. **Concurrency.** `PROC PYTHON` in one compute session is strictly serial. A
   second Run while one is in flight has undefined behaviour today. The backend
   needs an explicit busy/queue contract.
   > **Settled 2026-08-16 by 2b-i ([ADR-0015](docs/adr/0015-the-execution-backend-seam.md)).**
   > A second `execute` while one is in flight is **rejected**, not queued, and
   > the seam says so in its type: the rejection is a `BackendProblem`, not a
   > thrown error. Queueing was rejected because a queue makes the second run's
   > start time unpredictable and hides the serial constraint from the user
   > instead of reporting it. Enforcing it is 3a's job — nothing calls the seam
   > yet.
8. **Session death mid-run.** Compute sessions time out and get reaped. Whether
   Python state survives a reconnect is unverified. Detection, honest user
   messaging, and state-loss recovery all need designing.

### 1.6 Verdict

The premise is sound and the substrate is proven. The dominant risk is not "can
this work" but **scope**: the SAS extension is a large, mature codebase and it is
tempting to port breadth before the core execution path is trustworthy. The
phasing below is deliberately structured to resist that.

---

## 2. Target architecture

```
sas-py-vscode/
├── client/
│   └── src/
│       ├── extension.ts                 # activation, command registration
│       ├── connection/
│       │   ├── session.ts               # Session abstract base (from SAS ext)
│       │   ├── backend.ts               # ExecutionBackend seam  ← the key abstraction
│       │   ├── rest/
│       │   │   ├── auth.ts              # OAuth2 + PKCE
│       │   │   ├── common.ts            # HATEOAS link layer
│       │   │   ├── session.ts           # ComputeSession
│       │   │   ├── job.ts               # ComputeJob + log stream
│       │   │   └── api/                 # generated OpenAPI clients
│       │   └── backends/
│       │       └── procPython.ts        # PROC PYTHON backend (v1)
│       ├── dialects/
│       │   ├── base.ts                  # Dialect: paths, media types, capabilities
│       │   ├── viya4.ts
│       │   └── viya35.ts
│       ├── python/
│       │   ├── codeDocument.ts          # wrapping + offset map
│       │   ├── logFilter.ts             # SAS log → Python stdout
│       │   ├── traceback.ts             # traceback → Diagnostic
│       │   └── results.ts               # rich output model
│       ├── components/
│       │   ├── AuthProvider.ts
│       │   ├── profile.ts
│       │   ├── ResultPanel/
│       │   ├── ContentNavigator/
│       │   ├── LibraryNavigator/
│       │   └── notebook/
│       └── store/
├── contracts/                           # viya4.yaml, viya35.yaml — REST footprint
├── l10n/                                # bundle.l10n.json
├── client/test/                         # mirrors client/src
│   ├── unit/                            # mocked HTTP, no network
│   ├── integration/                     # VS Code test-electron
│   ├── live/                            # opt-in, real Viya, env-gated
│   └── fixtures/
│       ├── viya4/                       # sanitised per-generation captures
│       └── viya35/
├── NOTICE                               # Apache-2.0 attribution
└── .github/workflows/
```

### 2.1 Design principles

- **The `ExecutionBackend` seam is load-bearing.** Everything above it — commands,
  result rendering, notebook controller, diagnostics — talks to an interface, not
  to `PROC PYTHON`. `PROC PYTHON` is one implementation. This is what makes a
  future native-runtime swap a new file rather than a rewrite, and it is the
  reason we can commit to `PROC PYTHON` today without regret.
- **Never branch on version inline.** Viya differences live in `dialects/`. Lint
  and review enforce this, as in viyapy.
- **Capability probing over version gating.** Ask the deployment what it can do
  and degrade gracefully; use version only where a concrete defect is known. This
  is the SAS extension's `getViyaCadence` pattern, generalised.
- **No local Python.** The extension is pure TypeScript. Any proposal to add a
  local Python dependency requires an explicit written justification here.
- **Test the Viya path properly.** The SAS extension's REST layer is effectively
  untested — its own tests copy the logic under test into the test file. We will
  not inherit that. HTTP-level mocking against recorded fixtures from day one.

### 2.2 The `ExecutionBackend` interface (target shape)

Illustrative, to be settled in Phase 2b:

```ts
export interface ExecutionBackend {
  readonly id: string;
  capabilities(): BackendCapabilities;
  connect(): Promise<void>;

  readonly busy: boolean;          // PROC PYTHON is serial — this is not optional
  execute(code: string, opts: ExecuteOptions): Promise<ExecutionHandle>;
  cancel(handle: ExecutionHandle): Promise<void>;
  reset(): Promise<void>;          // discard interpreter state, keep the session
  close(): Promise<void>;
}

export interface ExecuteOptions {
  freshNamespace: boolean;         // Run File defaults true; notebook cells false
  origin: { uri: Uri; lineOffset: number };
}

export interface ExecutionResult {
  outputs: RichOutput[];           // NOT a single html5 string
  diagnostics: PythonDiagnostic[];
  succeeded: boolean;
}

export type RichOutput =
  | { mime: "text/plain"; data: string }
  | { mime: "text/html"; data: string }
  | { mime: "image/png"; data: string }   // base64
  | { mime: "application/vnd.python.traceback"; data: Traceback };
```

The deliberate departure from the SAS extension is `RichOutput[]` replacing
`RunResult { html5 }`. Getting this right early avoids a painful ripple through
the result panel, notebook renderers, and exporters later.

> **Settled 2026-08-16 by 2b-i.** The sketch above is superseded by
> [ADR-0015](docs/adr/0015-the-execution-backend-seam.md) and the code in
> `src/backend/`. `RichOutput[]` survives unchanged. Four things did not:
>
> - `execute` takes **bytes**, not code: `execute(program: Program, opts)` where
>   `Program` is `{ bytes, origin }`. This is ADR-0014 expressed as a type —
>   there is no code string for an `endsubmit;` to be interpolated into — and it
>   moves `origin` out of `ExecuteOptions`, since it is a property of the program
>   rather than of the run.
> - Every method returns a `BackendResult<T>` rather than a bare promise.
>   Failures are returned, not thrown, in the house style, over the seam's own
>   `BackendProblem` union — separate from `ComputeProblem`, which is a
>   vocabulary about HTTP.
> - `execute` resolves with an **`ExecutionHandle`** — `{ id, outputs, done }` —
>   that streams while the run is in flight. `ExecutionResult` is still the
>   aggregate shape and `collect()` derives it from a handle.
> - A second `execute` while one is in flight is **rejected**, not queued.
>
> The modules landed at `src/backend/{backend,problems,collect}.ts` and
> `src/dialects/{dialect,viya4,viya35,resolve}.ts`, rather than under the
> `client/src/connection/` tree sketched in §2 — this repository has no
> `client/` directory, and `dialects/base.ts` is `dialects/dialect.ts`.
> `contracts/` and stage-1 probing move to 2b-ii.
>
> **Amended 2026-09-03 by [ADR-0022](docs/adr/0022-drop-viya-35-support.md).**
> `src/dialects/viya35.ts` is removed; the layer is `src/dialects/{dialect,viya4,resolve,probe}.ts`.

### 2.3 Capability probing — in two stages, deliberately

Capabilities split by *how they are discovered*, and conflating the two creates a
circular dependency (you cannot ask Python its version before you can run Python).

**Stage 1 — HTTP-derived (Phase 2b).** Viya generation via
`/deploymentData/cadenceVersion`, endpoint presence, and dialect resolution.
Requires no execution, so it can ship with the seam itself.

**Stage 2 — runtime-derived (Phase 3e, after execution and log parsing exist).**
Whether `PROC PYTHON` actually works, the interpreter version and path, and the
installed package set. These require running code and reading the answer back.

Stage 2 has a second job beyond gating features: **the user has to be able to see
this**. The remote interpreter's package set is the thing that decides whether the
code someone is writing can run at all, and it is invisible from the editor — the
local environment even resolves imports that the deployment does not have. So the
installed package set is surfaced as a first-class, user-readable view, not merely
consulted internally (Phase 3e, extended in Phase 10).

Results are cached per session and surfaced in the status bar. If Python is
unavailable the extension says so plainly rather than failing obscurely on first
run. Probing is deliberately **fail-soft** — the one sanctioned place where a
swallowed exception is correct (§5), and it must carry a comment saying so.

> **Stage 1 settled 2026-08-17 by 2b-ii.** `src/dialects/probe.ts`, wired into
> `ComputeSessionManager.hold()`, with
> [ADR-0016](docs/adr/0016-api-contracts-are-checked-yaml.md) for `contracts/`
> and `docs/architecture/capability-probing.md` for the whole of it. Four
> departures from the sketch above:
>
> - **Two requests, not one.** `/deploymentData` is fetched and its
>   `cadenceVersion` relation followed, rather than composing
>   `/deploymentData/cadenceVersion` — ADR-0010 expresses a version difference as
>   the presence or absence of a relation, and a composed path cannot tell a
>   missing feature from a moved one. The relation is selected by media type as
>   well as by name: it appears twice in that document (finding 44).
> - **"Absent ⇒ likely 3.5" is not readable from a status code.** Finding 42: an
>   unrouted path is answered by the ingress with a bodyless 404, and a proxy or
>   VPN portal answers the same way. The signal is a three-way union — cadence,
>   absent, unreadable — and only the middle arm means 3.5.
> - **Probing runs after a session exists**, because a live session is what makes
>   a Viya-shaped 404 a statement about the endpoint rather than about the
>   network. Not "before execution" in the sense of "first thing on connect".
> - **Cached per profile, not per session**, and keyed on the endpoint too, since
>   a profile can be repointed in place. Only *certain* resolutions are cached.
>   Nothing is in the status bar yet — the log line is the whole surface, and its
>   level is the certainty.
>
> Endpoint presence beyond the cadence pair is recorded in `contracts/` rather
> than probed for. Stage 2 is unchanged and still 3e.
>
> **Amended 2026-09-03 by [ADR-0022](docs/adr/0022-drop-viya-35-support.md).**
> "Absent ⇒ likely 3.5" is retired along with 3.5 support: the middle arm of
> the three-way union now resolves the same as `unreadable` — assumed Viya 4,
> not confirmed anything — because there is no second generation left for a
> considered absence to identify.

---


## 3. Phases

Moved out of this file to keep it small enough to load every session. See
`STATUS.md` for the current phase and `docs/phases/` for the per-phase
architecture detail, punch list, and probe findings.

---

## 3.1 Feature parity with the SAS extension

**Parity is an explicit goal**, not an accident of the phase list. The target is
that a developer who knows the SAS extension finds the same capabilities here,
for Python — the brief's "the only difference is the language." What follows is
the working gap analysis, and it is the checklist to track parity against.

| SAS extension capability | Where it lands | Notes |
|---|---|---|
| Connection profiles, profile management | Phase 1a | Collapsed to Viya-only |
| OAuth2/PKCE auth, Accounts menu, token storage | Phase 1b–1c | Ported, with the PKCE defect fixed |
| Run file / run selection / cancel | Phase 3d-i | |
| Choosing where code runs | Phase 3d-i | **No upstream equivalent** — upstream claims a file only when it was opened *from* Viya. Ours is a per-workspace run target (ADR-0011), because the file in question is on local disk and already has a run button |
| Streamed execution log | Phase 2c + 3b | Needs the Python log filter |
| Result panel | Phase 3d-ii | Richer than upstream: `RichOutput[]`, not one HTML string |
| Errors in the Problems panel | Phase 4 | Tracebacks instead of SAS log parsing |
| SAS Content explorer (folders/files) | Phase 6 | Ports closely — language-agnostic |
| Remote file open/save in place | Phase 6b | |
| Library and table browsing | Phase 7a | |
| Data viewer (paged, sortable) | Phase 7b–7c | React/ag-grid panel ports |
| Notebooks | Phase 9 | **We intend to exceed upstream** — ipynb rather than a bespoke format |
| Status bar, connection state | Phase 3d-i / 3e | |
| Session startup / autoexec configuration | Phase 11 | Python analogue of `autoExecLines` + `sasOptions` |
| Result panel styling options | Phase 11 | |
| Snippets | Phase 11 | Viya-specific patterns; general Python is Pylance's job |
| Localisation | 0b (infrastructure), Phase 11 (bundles) | Upstream ships 10 locales |
| **CAS / SWAT access** | Phase 8 | **Upstream has none** — we exceed it here |
| Viya Python environment awareness | Phase 3e, extended in Phase 10 | No upstream equivalent. The package list ships with the first useful build, because you cannot write code against an interpreter you cannot see |
| Syntax highlighting, folding, completions, hover | — | Provided by `ms-python.python`/Pylance. Parity achieved by *not* building it. |
| SAS language server | — | Not applicable |
| SSH / COM / IOM connections | — | **Deliberate non-goal.** Viya-only by design. |
| SAS Studio flow conversion | — | **Deliberate non-goal.** |
| SAS 9 support | — | **Deliberate non-goal** (per the brief). |

Three honest caveats. First, parity is the *destination*, not the v0.1.0 bar —
§8's definition of done deliberately covers only the execution path, because a
half-built explorer is worth less than a trustworthy run command. Second, the
order of Phases 6–12 is a recommendation; real user demand after v0.1.0 should
reorder it, and parity-for-its-own-sake on a feature nobody asks for is waste.
Third, in three areas — CAS/SWAT, environment awareness, and notebook format — the
goal is to *exceed* the SAS extension rather than match it, because Python users
expect things SAS users don't.

---

## 4. Test architecture

| Tier | How to run | Notes |
|---|---|---|
| **Unit** | `npm run test:unit` | Mocked HTTP against fixtures; no network; no VS Code. The default and the bulk. |
| **Integration** | `npm run test:integration` | `@vscode/test-electron`; real editor, mocked Viya. |
| **Live** | `npm run test:live` | Opt-in, env-gated, hits a real Viya. Skipped unless configured. Never in default CI. |

**Fixtures are per-generation** (`test/fixtures/viya4/`), captured from real
responses and **sanitised of hostnames, tokens, and personal data**. The viyapy
generation-parameterised fixture idiom applies: happy paths run once per
generation so a dialect regression fails loudly.

> **Amended 2026-09-03 by [ADR-0022](docs/adr/0022-drop-viya-35-support.md).**
> `test/fixtures/viya35/` stayed empty from the day it was created — this
> project never had a Viya 3.5 deployment to capture anything from — and is
> removed along with 3.5 support.

**Live tests are gated three ways**: an opt-in npm script, per-generation env vars
(`PYTHON_ON_VIYA_TEST_VIYA4_URL` / `_TOKEN` / …), and a separate
`PYTHON_ON_VIYA_ALLOW_MUTATION` flag for anything that writes to the deployment. Mutating tests are self-cleaning with
per-run unique names and cleanup in `finally`.

**Coverage** starts at a threshold the Phase 0 harness actually meets and ratchets
upward per phase. The ≥85% target this section originally set was written against
a source tree — `connection/`, `dialects/`, `python/` — that only ever came half
true: the code landed under `src/{auth,backend,compute,dialects,profile}/`, and
`connection/` and `python/` were never created. The gate is a single aggregate
ratchet in `.c8rc.json` rather than a per-directory target; it has moved
several times since this was written (3b, the post-3f floor raise on
functions, then 4d's raise on lines/statements), so the actual current
numbers are whatever `.c8rc.json` says today rather than a figure copied
here — as of 2026-09-02 that's lines 94 / statements 94 / functions 93 /
branches 95. The original ≥85% figure is long since passed.
Ratcheting beats an aspirational gate that gets disabled the first time it blocks
a release.

**The submission fidelity corpus** is a named test asset, maintained forever
after it shipped. It is a directory of real Python programs chosen to
be hostile to SAS tokenisation — apostrophes in comments and docstrings, an odd
number of quotes in a line, triple-quoted strings containing both quote styles,
f-strings with nested quotes and braces, raw and byte strings, `&` and `%` in
string literals, the literal token `endsubmit;` inside a comment and inside a
string, a `;`-heavy one-liner, CRLF line endings, a tab-indented file, non-ASCII
identifiers and string content, an empty file, a file with no trailing newline,
and a file that opens with a UTF-8 byte-order mark. Each one is asserted **byte
for byte** at the far end.

> **Corrected 2026-08-25** (raised in `phase-3-runbook-pending.md`, applied
> here rather than held further — this is an amendments-log-style correction
> to a factual claim, not a rewrite of the plan's intent): the corpus shipped
> in **3-pre**, before 3a, not "introduced with Phase 3a" as this paragraph
> used to say. And the two tiers assert different things, not one shared
> claim: the **unit** tier compares against an independent second read of the
> fixture (what we intended to send), after a review round found and fixed a
> version that asserted on values it had itself constructed; only the
> **live** tier reads the value back out of a real interpreter (what SAS
> actually received). The paragraph below already describes this correctly —
> only the sentence above needed fixing.

That corpus runs in two tiers, and both are required. In the **unit** tier it runs
against the submission builder with a recorded transport, which is fast enough to
run on every commit and catches escaping regressions. In the **live** tier it runs
against a real deployment and reads the value back out of the interpreter, because
the unit tier can only prove we built what we intended to build — it cannot prove
SAS agreed. §1.5's first known-hard problem explains why this is not
proportionality gone wrong: the failure mode is not a syntax error, it is a
program that runs and quietly means something else.

**The specific anti-goal**: the SAS extension's `client/test/connection/rest/index.test.ts`
copies the logic under test into the test file, so the real REST path is untested
and the copy can drift. Any PR that does this gets rejected.

---

## 4.1 Documentation architecture

Docs are a deliverable of every slice, not a phase at the end. Same rule as tests:
a slice that changes behaviour and doesn't update its docs is incomplete. The
material splits into four audiences, each with a different home and lifecycle.

| Audience | Lives in | Written when |
|---|---|---|
| **User** — install, connect, run, troubleshoot | `docs/` (published site) + `README.md` | With the slice that ships the feature |
| **Contributor** — build, test, debug, release | `CONTRIBUTING.md`, `docs/dev/` | 0a, then amended per slice |
| **Architecture** — why it's built this way | `docs/architecture/` + ADRs in `docs/adr/` | At the decision, not after |
| **Reference** — settings and commands (API surface later) | Generated from `package.json`; TSDoc when there is an API | CI-generated, never hand-maintained |

**Generated, not transcribed.** The settings and command tables are generated
from `package.json` contribution points, and — once there is a public API worth
documenting — the API reference from TSDoc via TypeDoc. Hand-written copies of
machine-readable facts go stale silently — the same failure mode as the test
anti-goal in §4. CI regenerates and fails if the committed output differs.

> **Settled 2026-08-12 (in 0d-i-b): TypeDoc is deferred.** Recorded as
> [ADR-0004](docs/adr/0004-documentation-toolchain.md). `src/` is one
> activation file with no exported surface, so a generated API reference would be
> an empty page sitting under a diff gate, churning on every early change and
> documenting nothing. The settings and command reference ships now; TypeDoc
> arrives with the first module that has an API — realistically the
> `ExecutionBackend` seam in Phase 3. Until then no document may imply an API
> reference exists.

> **Settled 2026-08-12 (in 0d-i-a, executed in 0d-i-b): the generated reference
> is committed.** `.gitignore` ignored `docs/reference/` from 0a, which left
> nothing for the diff check above to compare against — the two rules could not
> both be true. Committing it wins for one reason that outweighs the diff churn:
> a pull request that changes a setting or renames a command then *shows* that
> change to the reviewer, instead of hiding it behind a build step nobody runs
> during review. It also makes the reference readable on GitHub without building
> a site. The `.gitignore` entry is removed in 0d-i-b, when there is a generator
> to produce the file.

**ADRs carry the *why*.** Every open decision in §6 becomes a short ADR when it's
settled — the licence choice, the trust posture, `PROC PYTHON` as the substrate,
the dialect seam. Two years from now the code says what; only the ADR says why,
and this repo will be maintained mostly by people reading it cold.

**The phase files are the evidence base, and are versioned.** Each probe slice
(`2-pre`, `3c`, `3e`) appends dated findings to the **Probe findings** section of
the current `docs/phases/phase-N.md`. When a finding is superseded, it is struck
through with the date and reason rather than deleted — a claim that quietly
changed is worse than one that visibly changed.

> **Amended 2026-08-25.** This paragraph named `PROBE-FINDINGS.md` as the
> evidence base. PR #52 split that file into `docs/phases/phase-N.md`, one per
> phase; `PROBE-FINDINGS.md` is now a stub redirect holding no findings, and
> finding numbers were not renumbered when the content moved. Recorded as an
> amendment rather than a silent rewrite because where the evidence base lives
> is a documented invariant.

**Honesty gate.** Docs may not claim Viya 3.5 support at all (§1.4 — dropped by
[ADR-0022](docs/adr/0022-drop-viya-35-support.md)), may not document a
capability the runtime probe can't confirm, and must state plainly that no
telemetry is collected. Anything aspirational belongs in the roadmap section,
labelled as such.

**CI enforcement** (0d-i-b): the site builds without warnings, internal links
resolve, the generated reference matches source, and every `docs/` code sample
that claims to run is type-checked. **Phase 5c** is then *publishing* — deploying
the site, the marketplace listing, the release checklist — not the first time docs
get written.

> **Settled 2026-08-12 (in 0d-i-b): VitePress, and external links are swept on a
> schedule rather than gated on pull requests.** Recorded in full, with the
> rejected alternatives, as
> [ADR-0004](docs/adr/0004-documentation-toolchain.md).
>
> VitePress over Docusaurus — which is what upstream runs — because it is
> markdown-first and needs almost no restructuring of `docs/`, and because its
> build fails on dead *internal* links natively. That folds one of the four CI
> checks above into a build we were running anyway, rather than bolting on a
> second tool that has to be taught the same link conventions.
>
> External links are a different problem wearing the same clothes. They rot for
> reasons unrelated to the pull request that happens to be open, so gating on
> them produces red CI caused by somebody else's outage — and a check that cries
> wolf gets ignored exactly when it is right. They are swept weekly instead, and
> rot is filed as an issue.

---

## 5. Quality gates

- **TypeScript** `strict: true`, no implicit `any`, no unchecked non-null assertions.
- **ESLint + Prettier**, enforced in CI, matching the SAS extension's config so
  ported code needs no reformatting.
- **No `console.log` in shipped code** — use the output channel.
- **No bare `catch` that swallows** — either handle meaningfully or re-raise with
  context. The one sanctioned exception is capability probing, which is
  deliberately fail-soft and must carry a comment saying so.
- **No secrets in logs, tests, or fixtures** — secret scanning in CI.
- **Every error branch has a regression test.**
- **All user-facing strings go through `l10n.t()`** — ported code arrives full of
  them (285 call sites upstream), so this is the path of least resistance anyway.
- **Copyright headers** preserved on ported files **and marked as modified**
  (Apache-2.0 §4(b) obligation), checked in CI.
- **Ported security-relevant code is audited, not transcribed** (Phase 1b).
- **Every PR**: green CI, `CHANGELOG.md` entry under `[Unreleased]`, docs updated
  if behaviour changed (§4.1), and an ADR when a §6 decision is settled.
- **Generated reference is regenerated, not edited** — CI fails if the committed
  settings/command tables or TypeDoc output differ from what the source produces.

---

## 6. Risks and open decisions

**Risks**

| Risk | Impact | Mitigation |
|---|---|---|
| ~~Licensing — Apache-2.0 code shipped under MIT~~ | ~~High — legal~~ | **Retired.** Settled to Apache-2.0 (ADR-0000); executed in 0a. Residual risk is now only header/NOTICE discipline, enforced by the CI copyright check |
| **`endsubmit;` / macro injection** in submitted Python | **High — correctness + security** | **Settled 2026-08-16 (findings 31–35).** Inlining *is* unsafe — `endsubmit;` in a string ends the block and the poisoned session then reports `completed` having run nothing. Mitigation is upload + `proc python infile=<fileref>;`, which tokenises none of the file; 3a's corpus tests upload fidelity rather than escaping |
| ~~Rich output has no clean return path~~ | ~~High — reshapes Phase 3~~ | **Retired.** Settled by 3c's probe (findings 61–67) and 3c-i (ADR-0019): write to the session's working directory, retrieve by diffing a before/after listing. `print`-only was the v1 floor; never needed |
| ~~Namespace reset requires killing the session~~ | ~~Medium — degrades cancel *and* Run File~~ | **Retired 2026-08-16 (finding 38).** `proc python restart;` clears the interpreter in ~3.4 s with the compute session, its libraries and its filerefs untouched, and composes with `infile=` in one statement |
| Session dies mid-run / state lost on reconnect | Medium | Explicit detection and messaging in 2a; fixture-driven tests |
| ~~`PROC PYTHON` absent on Viya 3.5~~ | ~~Medium~~ | **Retired 2026-09-03 ([ADR-0022](docs/adr/0022-drop-viya-35-support.md)).** Moot: Viya 3.5 support is dropped entirely rather than shipped as an unverified capability probe |
| ~~Compute cancellation doesn't interrupt a running Python step~~ | ~~Medium — bad UX~~ | **Settled the pessimistic way, 2026-09-01 (Phase 4's 4b probe, Findings 75/76).** It does not preempt: a cancelled statement runs to its natural end regardless. Fixed what was fixable — `cancelJob()` was also silently failing outright on this deployment (missing `If-Match`, Finding 75), corrected in 4c and live-verified; the "Cancelled." message was reworded to say only what's true (this window's view has stopped; Viya may keep executing the in-flight step) rather than add background tracking machinery. No fallback "busy" message for a run/reset queued behind a still-executing cancelled job — considered and left as a documented gap, not a defect, since nothing is corrupted, only unexplained-slow |
| ~~Phase 2a exceeds a reviewable PR~~ | ~~Medium~~ | **Retired 2026-08-14.** The pre-agreed boundary was the generated client, and ADR-0010 means there is no generated client to split at. 2a split three ways on a different seam — core / VS Code shell / one account, one command — and each part was reviewable on its own |
| Large stdout volumes truncate or slow the log poll | Medium | High-volume fixtures in 3b |
| Ported code arrives carrying upstream defects | **Medium, and repeatedly confirmed** | Audit-don't-transcribe rule (Phase 1b). No longer a hypothetical: reading `auth.ts` found five, `AuthProvider.ts` four, and `CAHelper.ts` two. Every ported file gets read before it is trusted, and the findings are recorded in the slice that ports it |
| Upstream SAS extension diverges | Low | We fork conceptually, not continuously; port once and own it |
| Scope creep into SAS-extension parity before the core is solid | **High** | The phase ordering exists precisely for this; resist reordering |

**Open decisions** (settle at the top of the relevant phase)

0. ~~**Repository licence**~~ — **SETTLED 2026-08-11: Apache-2.0.** The repo
   relicenses from MIT in slice 0a, matching upstream so ported files carry no
   conflict, and gaining the explicit §3 patent grant that matters when
   interoperating with a commercial vendor's product. Recorded as ADR-0000.
1. ~~**Extension identifier and display name**~~ — **SETTLED 2026-08-12:
   "Python on Viya", identifier `python-on-viya`.** Names the function rather than
   leading with the SAS trademark, consistent with `NOTICE`'s statement that this
   is not an official SAS product. Recorded as ADR-0001, executed in 0b.
2. ~~**Configuration namespace**~~ — **SETTLED 2026-08-12: `pythonOnViya.*`**,
   matching the extension identifier per VS Code convention. The provisional
   `SASPY.*` is **withdrawn**: `saspy` is the name of SAS's own official
   Python-to-SAS package, so that prefix would have collided with a real SAS
   product in both search results and users' expectations — a worse problem than
   the `SAS.*` collision it was chosen to avoid. Recorded as ADR-0001, executed in
   0b. Every `SASPY` reference in this document is superseded by `pythonOnViya`.
3. ~~**Workspace-trust posture**~~ — **SETTLED 2026-08-12: `"limited"`.** Editing,
   syntax, and profile management work in untrusted folders; connecting and
   executing require trust. Executing code on a remote server from an unvetted
   folder is precisely the risk workspace trust exists to gate. Recorded as
   ADR-0002, executed in 0b.
4. ~~**Web/browser extension target**~~ — **SETTLED 2026-08-12: node-only.**
   Halves the build and test matrix through Phases 1–5, and avoids letting the web
   host's ban on Node APIs constrain the OAuth loopback listener and secret
   handling before those are even built. Revisit as a Phase 6+ item, not never.
   Recorded as ADR-0003, executed in 0b.
5. ~~**Coexistence with the SAS extension**~~ — **SETTLED 2026-08-12: separate
   storage, plus a one-time read-only import.** Our own
   `pythonOnViya.connectionProfiles`, and a
   `Python on Viya: Import Profiles from the SAS Extension` command that reads
   their `connectionType: "rest"` profiles and copies the endpoint, context and
   client id into ours. We never write their key. Sharing was rejected on
   evidence rather than taste: their config listener runs `SAS.close` on *any*
   change to that key, so our writes would terminate a user's running SAS
   session; both sides do whole-object read-modify-write with no merge; their
   `migrateLegacyProfiles()` rewrites profiles it does not recognise on every
   activation; and SecretStorage is per-extension, so tokens could never be
   shared anyway. Recorded as ADR-0007, executed in 1a.
6. ~~**Coverage starting threshold**~~ — **SETTLED 2026-08-12: 0%, with a
   ratchet.** The only shipped module is the activation entry point; it imports
   `vscode`, so it is unloadable outside an extension host and invisible to c8.
   Any non-zero number would have been fiction. The rule that makes zero safe is
   the ratchet: **a slice that adds code to `src/` raises the thresholds in the
   same pull request**, to just under whatever the suite then measures.
   Thresholds go up and never down. The vendored generated OpenAPI clients are
   the one sanctioned exclusion from the denominator — everything else stays in,
   because excluding hard-to-test code is how a ratchet gets gamed. Recorded in
   `.c8rc.json` and `docs/dev/testing.md`, executed in 0c.
   **Amended 2026-08-13 by ADR-0009, which supersedes the exemption above.** The
   denominator is now unit-reachable code: a module is excluded **if and only if
   it imports `vscode`**, and `scripts/check-coverage-scope.mjs` enforces that in
   both directions on every `npm run verify`. A vendored generated client does
   not import `vscode`, so the check will **refuse** to exclude it — which is the
   correct default, because "the tier physically cannot load this" is a fact and
   "this was generated, not written" is an argument. The ratchet itself is
   unchanged and still binding.
   **Amended again 2026-08-16 by ADR-0009's own amendment:** importing `vscode`
   is no longer the only way to be unreachable. A module of nothing but types
   compiles to an empty JavaScript file that no test can execute either, so the
   operative rule is *excluded if and only if the unit tier cannot reach it*,
   with two ways to qualify. `src/backend/backend.ts` is the first module here to
   qualify the second way.
   **Closed 2026-08-14 by ADR-0010:** no client is vendored, so the question of
   how to exclude one does not arise. The Compute layer is hand-written against
   the observed wire shape, imports no `vscode`, and stays in the denominator
   like any other pure module. ADR-0009's three options remain the right three
   should vendoring ever be proposed again.
7. **Notebook format** (Phase 9a). ipynb-compatible vs bespoke. *Recommend ipynb —
   the Python ecosystem expects it — but defer until Phase 9.*
8. **Package installation into Viya** (Phase 10). Governance question, not a
   technical one. Deferred deliberately.
9. ~~**Default OAuth client id**~~ — **SETTLED 2026-08-13: fall back to the
   built-in `vscode` client on Viya 4 2022.11 and later; require an explicit id
   and secret on Viya 3.5 and Viya 4 2022.10 and earlier.** The alternative was
   asking every administrator to register a `python-on-viya` client before the
   extension could be used at all, which buys nothing a user can perceive and
   puts an IT ticket between install and first connection — the surest way to
   lose an evaluation. The `vscode` client is public, registered by the
   deployment itself, and carries no secret; it is not SAS's to grant or
   withhold per-extension, and using it does not deprive the SAS extension of
   anything. Executed in 1b-i. **The 3.5 branch is the one that must not degrade
   silently**: on a deployment that has no built-in client, an empty `clientId`
   has to produce a message naming what to ask an administrator for, not an
   opaque OAuth failure.
   **Amended 2026-08-13 — the 3.5 branch is unverified and will stay that way for
   now.** An earlier version of this entry said the live check was blocked by the
   sandbox proxy and that 1b owed it a verification before release. That was too
   optimistic about a temporary obstacle: there is no Viya 3.5 deployment
   available to this project at all, so the check is not pending, it is not
   possible. What ships is built from SAS's documented behaviour for their own
   extension, and the honest statement of its status is *unverified against a live
   3.5 deployment*, recorded here, in `docs/adr/0008`, and in a comment on the
   code path itself so it cannot be mistaken later for something that was
   observed. This is not a release blocker — a release blocker that nobody can
   clear is just a line everybody learns to step over. It is a standing invitation:
   if a 3.5 deployment ever becomes reachable, this is the first thing to point at
   it. The risk being carried is bounded and worth naming: if SAS's documentation
   is wrong about 3.5 having no built-in `vscode` client, the cost is that we tell
   a 3.5 user to go get a client id they did not actually need — a bad message,
   not a broken or insecure flow.
   **Amended 2026-09-03 by [ADR-0022](docs/adr/0022-drop-viya-35-support.md) —
   the 3.5 branch is removed, not carried unverified.** Very few Viya 3.5
   customers remain in the target audience, and no 3.5 deployment ever became
   reachable to close the standing invitation above. The client-id-required
   refusal now only fires for an old Viya 4 release (2022.10 and earlier),
   which was always the other, verified half of this decision.
10. ~~**What identifies an account in the Accounts menu**~~ — **SETTLED
    2026-08-13: the endpoint plus the Viya user `id`.** The alternative, the user
    id alone, is what upstream effectively does, and it is wrong for the audience
    this extension is built for: developers point at a development deployment and
    a production one, usually as the same person. Under a user-id-only key those
    collapse into a single account row, so signing out of dev signs you out of
    prod, and a token minted for dev becomes a candidate for a request to prod —
    a confused-deputy shape, not merely a display bug. Keying on the endpoint too
    makes them two rows, which is what a user already believes they are. Within
    that, the identifier is the `id` field and nothing else: probe finding 8
    showed `scimId` is provider-dependent and absent outside SCIM-backed
    deployments, and `name` and the login are the fields an administrator can
    change. The `label` is the display `name`, falling back to the login and then
    to `id`. The `session.id` is separately the profile's generated id rather
    than its name, so renaming a profile does not orphan the session attached to
    it. Executed in 1c-i.
11. ~~**How a user chooses Viya rather than the local interpreter**~~ — **SETTLED
    2026-08-14 by [ADR-0011](docs/adr/0011-choosing-where-python-runs.md): a
    per-workspace run target, set from the status bar, which decides whether this
    extension appears in the editor at all.** This was never written down: the
    repository has always been clear that editing intelligence is delegated to
    `ms-python.python`, and silent about what a user presses. The collision is
    real — on a local `.py` file the run button already exists and belongs to
    Microsoft — and both directions of getting it wrong are expensive, since code
    written for Viya can run locally and look fine, while a stray local run's
    opposite sends code to a shared deployment. The rejected alternative worth
    naming is the obvious one: make our action the play button whenever a profile
    is signed in. That makes the button's meaning a function of authentication
    state, so a habitual click ends up in production because a token happened to
    be live. Executed in 3d-i. **ADR-0011's own default (Viya) was reversed to
    Local by [ADR-0020](docs/adr/0020-run-target-defaults-to-local.md),
    2026-08-26** — the "confirm by hand" editor check ADR-0011 itself called
    for found this extension's Run File winning the *primary*
    `editor/title/run` slot ahead of `ms-python.python`'s on a workspace where
    it had never been invoked, exactly the outcome ADR-0011 said would mean
    revisiting the default. An unconfigured workspace now contributes nothing
    to the editor until a user explicitly asks for Viya.

**Smaller items to settle in-phase, recorded so they aren't forgotten:** activation
events and a lazy-load rule (an `onLanguage:python` activation would fire for every
Python user on every file — 0b); ~~profile-schema versioning and a migration
path~~ (**settled 2026-08-12: an explicit `version` field on every profile from
day one; migrations key off it, and a profile whose version is *higher* than this
build understands is refused with a clear message rather than half-read** —
ADR-0007); ~~profile setting scope across multi-root workspaces, which also
affects 2a's `workspaceState` reconnect~~ (**settled 2026-08-12: profiles are
`window`-scoped and stored in user settings; the pointer to the *active* profile
lives in `workspaceState`, so two *workspaces* can target two deployments at once
— two windows on the same folder share one pointer — and it sits next to where 2a
keeps the compute session id, which ADR-0012 puts at the same grain for the same
reason** — ADR-0007); and
localisation — whether we ship non-English bundles at all (0b; English-only is
fine, but say so).

---

## 7. AI code review

Two comment-only reviewers per `AI-PR-REVIEWERS-RUNBOOK.md`: the Claude reviewer
(`anthropics/claude-code-action@v1`, Azure OIDC into Foundry) and the Codex
reviewer (stdlib-only Python script against the Foundry Responses API).

Two ordering constraints matter and are easy to trip over:

- The Claude action **refuses to run unless `claude-review.yml` is byte-identical
  to the copy on `main`**. So the workflow cannot be tested on its own PR — it must
  merge to `main` first, then a *subsequent* PR gets reviewed.
- The Codex workflow checks out `base.sha` for security, so the PR that introduces
  `ai_review.py` cannot review itself.

Both are expected and handled by bootstrapping in **slice 0a-ii** and verifying on
a throwaway smoke-test PR afterwards.

**Status as of 2026-08-11.** Azure and GitHub configuration is **complete**: a
federated credential for `repo:Shai-Alit/sas-py-vscode:pull_request` exists on the
shared Entra app, the Cognitive Services User role is confirmed at the Foundry
account scope, and the four secrets plus four variables are set on the repo. The
three workflow files are written and their prompts **rewritten for this repo** —
the viyapy versions were Python/SAS-specific and would have given poor signal on a
TypeScript extension. The rewritten prompts enforce this plan's own rules: the
sanctioned-fail-soft-catch carve-out, the two upstream recursion bugs, the
`Math.random()` PKCE defect, `endsubmit;` escaping, `l10n.t()`, the Apache-2.0
§4(b) modified-file notice, and the copy-logic-into-tests anti-goal from §4. Both
reviewers are also pointed at the phase files' **Probe findings** sections and
instructed to flag any claim about Viya behaviour those files don't support —
which makes the probe record machine-enforced rather than merely well-intentioned.

What remains for 0a-ii is only the merge and the smoke test.

---

## 8. Definition of done

v0.1.0 ships when: the extension installs from the marketplace and activates
cleanly on Windows, macOS, and Linux; a user can create a Viya connection profile,
authenticate via OAuth2/PKCE, and run a `.py` file or selection on Viya; stdout
streams live and errors appear as accurately-positioned diagnostics; no local
Python is required; unit tests cover every public path including error branches
with no network in default CI; the live tier passes against a real Viya 4; CI is
green across lint, type-check, test, security, and drift; the licence is
consistent with everything we bundle and the `NOTICE` is complete; the
workspace-trust posture is declared and enforced; **no telemetry is collected,
and the marketplace listing says so**; the docs site builds clean with no broken
links and its generated reference matches source, and describes setup and
limitations honestly; every settled §6 decision has an ADR; and no secrets appear
anywhere in the repo or logs.

> **Amended 2026-09-03 by [ADR-0022](docs/adr/0022-drop-viya-35-support.md).**
> This criterion used to also require "the 3.5 scaffold is present and skipped"
> and that the docs honestly describe 3.5 as unverified. Viya 3.5 support is
> dropped rather than shipped unverified, so neither applies: there is no
> scaffold, and the docs make no claim about 3.5 at all.
