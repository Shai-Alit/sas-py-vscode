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
- Viya 3.5 and Viya 4 both handled, with version differences absorbed at a seam
  rather than branched inline.

---

## 1. Current-state assessment

### 1.1 What exists today

| Asset | State |
|---|---|
| `Shai-Alit/sas-py-vscode` | Empty repo — `LICENSE` (**MIT**) and one initial commit. Everything below is greenfield. |
| `sassoftware/vscode-sas-extension` (cloned locally) | v1.20.0, **Apache-2.0**, the reference architecture. Substantial reuse is legally permitted with attribution and preserved copyright headers. |
| Live Viya 4 deployment | Available and probed. See `PROBE-FINDINGS.md`. |
| Viya 3.5 deployment | **None available.** This shapes the entire 3.5 strategy (§1.4). |
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

### 1.4 Supported Viya versions — the honest position

Viya 3.5 is a frozen on-prem generation in Standard Support to 2027-10-01; Viya 4
is date-versioned and continuously moving. The brief requires both.

**Decision: architectural first-class support, empirically unverified.** We build
a dialect/capability seam so 3.5 is properly represented in the design and a
retrofit is never needed, and we ship a 3.5 test tier as a **permanently-skipped
scaffold** until an instance exists — exactly the viyapy pattern. What we will
**not** do is claim verified 3.5 support in user-facing docs. It is unknown
whether `PROC PYTHON` exists on 3.5 at all; that is logged as a risk (§6), and
the capability probe (§2.3) is designed to degrade gracefully and tell the user
plainly if the runtime is absent.

### 1.5 Known-hard problems, identified up front

These are the parts that will consume disproportionate effort. Naming them now
prevents them being discovered as "small" tasks mid-phase.

1. **Submitted-code escaping — a correctness *and* security problem.** We wrap user
   Python in `proc python; submit; … endsubmit; run;`. Any user code containing the
   token `endsubmit;` — even inside a string or comment — terminates the block
   early and the remainder is interpreted as **SAS**. `&` and `%` may additionally
   trigger SAS macro resolution inside the block. That is both a bug and an
   injection path from Python source into SAS. Unverified by the probe. The
   injection-free alternative is `proc python file="…"`, uploading the code to the
   session filesystem instead of inlining it; that is likely the right answer and
   must be probed before 3a is written.

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
   the wrong mechanism. `proc python file="…"` is favoured for exactly this reason:
   a file transfer has no tokeniser in the middle of it.
2. **Log hygiene.** The Compute log is a *SAS* log: numbered source echo, page-break
   headers, `>>>` REPL markers, procedure timing NOTEs. Turning it into clean
   Python stdout is real parsing work, not a pass-through.
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
7. **Concurrency.** `PROC PYTHON` in one compute session is strictly serial. A
   second Run while one is in flight has undefined behaviour today. The backend
   needs an explicit busy/queue contract.
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

### 2.3 Capability probing — in two stages, deliberately

Capabilities split by *how they are discovered*, and conflating the two creates a
circular dependency (you cannot ask Python its version before you can run Python).

**Stage 1 — HTTP-derived (Phase 2b).** Viya generation via
`/deploymentData/cadenceVersion` (absent ⇒ likely 3.5), endpoint presence, and
dialect resolution. Requires no execution, so it can ship with the seam itself.

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

---

## 3. Phases

**One slice = one branch = one PR.** Slices within a phase are sequential unless
noted. Sizing is relative, not calendar time.

### Phase 0 — Repository foundation

Nothing here is interesting, and all of it is load-bearing. Doing it first keeps
history clean and means every later PR lands into a working gate.

**0a — Scaffold, hygiene, and licensing.** Executes the settled licence decision —
`LICENSE` becomes Apache-2.0 and ADR-0000 records why.
Then `.gitattributes` (`* text=auto eol=lf` — dev is Windows, CI is Linux; this
must be the *first* file so history stays clean), `.gitignore`, `README.md`,
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md` (Keep a
Changelog 1.1.0), issue/PR templates, `CODEOWNERS`, `dependabot.yml`, and a
`NOTICE` recording upstream attribution. Also **copy `PROBE-FINDINGS.md` into the
repo** — the plan cites it throughout and it currently lives outside — and stand up
the `docs/` skeleton (`docs/dev/`, `docs/architecture/`, `docs/adr/` with ADR-0000
recording the licence decision) per §4.1. *Small.*

**0a-ii — AI reviewer bootstrap.** The two reviewer workflows
(`claude-review.yml`, `ai-review.yml`, `.github/scripts/ai_review.py`), merged
early and deliberately: they must exist on `main` before they can review anything
(§7), and validating them here means we're not debugging OIDC while also trying to
land real code. Azure-side setup — the federated credential for
`repo:Shai-Alit/sas-py-vscode:pull_request`, the Cognitive Services User role, and
the repo secrets/variables — was completed **2026-08-11** and is not part of this
slice. Ends with the throwaway smoke-test PR that proves both bots engage, then
closes **without merging**. *Small.*

> **Why this moved out of 0d-ii.** Reviewers that arrive after the code they
> should have reviewed are decoration. The only genuine ordering constraint in
> Phase 0 is that `.gitattributes` lands first, and 0a satisfies it — so the
> reviewers can be live from the second PR onward. 0d-ii keeps only the security
> scanning it was always going to carry.

**0b — TypeScript toolchain.** `package.json` extension manifest skeleton,
`tsconfig` (strict), ESLint + Prettier, esbuild/webpack bundling, `.vscodeignore`,
the copyright-header check (adapted from the SAS extension's `check-copyright.mjs`,
**extended to require a modified-file notice** on ported files), `@vscode/l10n`
setup and `l10n/bundle.l10n.json` extraction, and npm scripts that mirror CI.
Settle three things here: the configuration namespace, the **workspace-trust
posture**, and whether we ever ship a **web/browser** target. *Small/medium.*

> **Workspace trust is not a formality for this extension.** Our entire purpose is
> executing code on a remote corporate system. Copying the SAS extension's
> `untrustedWorkspaces.supported: true` unthinkingly would mean opening an
> untrusted folder can run its `.py` against production Viya. *Recommend
> `"limited"`, with execution commands disabled until trust is granted.*

**0c — Test harness.** Mocha + Chai + Sinon, `@vscode/test-electron` integration
runner, **plus the HTTP mocking layer** (nock or msw) and `test/fixtures/`
structure with per-generation subdirectories. Coverage instrumentation (c8) with
a threshold that starts realistic and ratchets. A trivial passing test proves the
whole harness. *Medium.*

**0d-i-a — Core CI and packaging.** Lint/format, type-check, copyright and
coverage gates; the test matrix (Node floor and working version × ubuntu /
windows / macOS, `xvfb-run` on Linux for test-electron); `.vsix` packaging with
an assertion on what the package actually contains, uploaded as an artifact.
*Medium.*

**0d-i-b — Docs CI.** The **docs job** from §4.1 — generate the settings and
command reference from `package.json`, fail on any diff against the committed
copy, check that internal and external links resolve, and type-check every
`docs/` sample that claims to run. *Medium.*

> **Why 0d-i split.** 0d-i-b is not more CI wiring; it is choosing a static-site
> generator and writing a reference generator, neither of which exists yet.
> Bundling that with the test matrix would produce one PR where a reviewer has to
> hold a tooling choice and CI mechanics in mind at once, and the tooling choice
> is the part that deserves undivided attention. Same reasoning that split 0a
> and 0d.

**0d-ii-a — Supply chain.** The dependency audit gate — hard on the production
tree at any severity, allow-listed with expiry dates on the dev tree — and the
install-script policy: an `allowScripts` field in `package.json` denying every
package that asks to run code at install time, enforced by a dedicated
`supply-chain` CI job and by a unit test that reads the lockfile. *Medium.*

**0d-ii-b — Scanning.** CodeQL, a repo-local scanner for credential-shaped
strings, and the adapted `AI-PR-REVIEWERS-RUNBOOK.md` checked into the repo for
future maintainers. The reviewer workflows themselves moved to **0a-ii**. *Small.*

> **Why 0d-ii split.** Same reasoning as 0d-i. 0d-ii-a is a policy decision that
> had to be settled by experiment — whether each install script is load-bearing
> is a question only a clean install can answer, and the answer reversed what the
> runbook had assumed about esbuild. 0d-ii-b is mostly workflow wiring. Bundling
> them would put a supply-chain argument and a pile of YAML in front of one
> reviewer at the same time.

> **The constraint that shaped 0d-ii-a.** `allowScripts` is understood only by
> npm 12.0.0+, and npm 12 requires Node `^22.22.2 || ^24.15.0 || >=26.0.0` — so it
> cannot run on the Node 20.19.0 floor §4 claims and the matrix tests. Rather
> than move the support floor as a side effect of a security slice, the policy is
> enforced in one job that can run it. The rest of CI still installs with those
> scripts running, and `docs/dev/building.md` says so rather than implying a
> guarantee that is not there.

*Exit:* a green CI on an empty extension that installs and activates.

### Phase 1 — Authentication and connection profiles

**1a — Connection profiles.** `pythonOnViya.connectionProfiles` setting, profile
add/edit/delete/switch commands, a one-time import from the SAS extension, and a
status bar item. Collapsed to a single Viya profile type — no SSH/COM/IOM
branches, so the upstream JSON-Schema `if`/`then` discriminator collapses with
them and is not ported. Every profile carries a `version`; the active profile
lives in `workspaceState`; the client secret lives in SecretStorage and never in
settings (ADR-0007). *Medium.*

> **The unit tier cannot import `vscode`,** so this slice establishes the seam
> every later one inherits: the profile *model* — types, validation, migration,
> the import filter — is a module with no `vscode` import and is specified by
> unit tests, while the thin store that wraps `workspace.getConfiguration` and
> `SecretStorage` is exercised in the extension host. Logic that drifts into the
> shell becomes untestable at the cheap tier, which is how a suite quietly stops
> being a specification.

**1b — OAuth2 + PKCE.** Port `auth.ts`: authorization-code flow with PKCE, the
**dual code capture** (URI handler *and* paste box racing, whichever lands first)
which is the pragmatic fallback for deployments without a registered redirect URI,
and 401-triggered refresh. **Corrected 2026-08-14 against a live deployment:** the
built-in `vscode` client registers `urn:ietf:wg:oauth:2.0:oob` and no
custom-scheme URI, so on a stock Viya 4 the paste box is not the fallback — it is
the only arm that can win, and the URI handler only ever fires against a client an
administrator registered with this extension's redirect URI. The race stays,
because which of the two applies cannot be known until after the user has
authenticated. An empty `clientId` falls back to the built-in
`vscode` client (decision 9); 3.5 and pre-2022.11 Viya 4 have no such client and
must be told to supply an id and secret in those words, because the failure they
would otherwise see is a generic OAuth rejection. Also add corporate
**proxy support**, which the SAS extension lacks and which is a known failure
class behind an enterprise proxy. *Medium.* **Split into 1b-i and 1b-ii on
2026-08-13**, along the same seam 1a used: the part that can be specified by
unit tests, and the part that can only be exercised in an extension host.

**1b-i — the auth core.** `src/auth/`, with no `vscode` import anywhere in it.
Three modules. `pkce.ts` mints the code verifier, the S256 challenge, and — see
the audit below — a random `state`. `tokenEndpoint.ts` builds the authorize URL
and makes the two SASLogon calls, `authorization_code` and `refresh_token`,
parsing the OAuth error envelope into a typed failure and converting `expires_in`
into an absolute `expiresAt` at the moment the response is read. `clientId.ts`
resolves decision 9, returning either the built-in `vscode` client or a typed
problem code in the style `src/profile/problems.ts` already establishes — codes
and parameters, never English prose, so the core stays free of `vscode.l10n` and
the message is still localisable in the shell. HTTP arrives as an injected
`fetch`-shaped port (ADR-0008), which means the whole slice is testable at the
cheap tier with no editor and no network. *Small-to-medium.*

**1b-ii — the VS Code shell.** `env.asExternalUri` and `env.openExternal`,
`window.registerUriHandler`, `window.showInputBox`, and the race between the last
two; validating the returned `state` on the URI-handler arm; proxy support; and
persisting tokens through `SecretStorage` next to the profile they belong to.
*Medium.* **As built,** proxy support arrives by making the request through
`https.request` and inheriting whatever the extension host has already arranged
on Node's `https` module — not through the undici `ProxyAgent` this paragraph
originally named. undici was evaluated in the slice and rejected: it buys a
`ProxyAgent` and loses the operating-system certificate trust that
`https.request` gets for free, and the internal-CA case is both more common than
the proxy case and indistinguishable from it in a bug report. ADR-0008 records
the reversal. The transport sets no `agent` deliberately, leaving that parameter
free for 1c-ii to attach an explicit CA bundle to.

> **Audit ported security code; do not transcribe it.** A close read of upstream's
> 145-line `auth.ts` on 2026-08-13 found five things worth changing, not one.
>
> 1. **The PKCE code verifier is built with `Math.random()`**, which is not a
>    CSPRNG and does not satisfy RFC 7636. Worse, it is drawn character-by-character
>    from a 66-character alphabet, which is also a modulo-bias shape. Use
>    `randomBytes(32).toString("base64url")`: 43 characters, uniformly distributed,
>    and every character is in the unreserved set by construction rather than by
>    a lookup table that has to be audited.
> 2. **The `state` parameter is never validated.** Upstream packs the callback URL
>    into `state` and then ignores it on the way back — `handleUri` reads `code`
>    out of any inbound URI and accepts it. A registered URI handler is not a
>    private channel, so this is the authorization-code CSRF that RFC 6749 §10.12
>    exists to prevent. Mint a random `state` and require it to match. This one is
>    arguably more serious than the verifier and was not previously recorded here.
> 3. **base64url is hand-rolled** as three chained `.replace()` calls on a base64
>    digest. Node has done this correctly since v15: `.digest("base64url")`.
> 4. **`expires_in` is discarded**, so the only way the extension can discover that
>    a token died is to spend a request finding out — which is exactly what
>    `refreshToken()` does, firing `headersForRoot()` on every call purely to see
>    whether it 401s. Keep the expiry and refresh ahead of it; a 401 from a real
>    request stays as the fallback, not the mechanism.
> 5. **The token endpoint's error envelope is dropped.** OAuth returns `error` and
>    `error_description`, and both are thrown away inside an axios rejection, which
>    is a large part of why a misconfigured client id surfaces as noise. Parse them.
>
> The same rule applies to every security-relevant file we port — upstream
> `CAHelper.ts`, for instance, arrives with a `console.log` inside a `catch`,
> violating two §5 gates on arrival.

**1c — AuthenticationProvider and secret storage.** VS Code `AuthenticationProvider`
so Viya appears in the Accounts menu; per-profile token namespacing in
SecretStorage; session change events; the `authorized` context key. Plus the
self-signed-certificate helper — deployments with private CAs are common and this
is 30 lines that prevents a class of unactionable failures. *Medium.* **Split into
1c-i and 1c-ii on 2026-08-13.** The two halves share a slice number and nothing
else: one is an editor integration whose risk is state management, the other is a
TLS change whose risk is that it silently widens what the extension will trust.
A single review would have to hold both, and the certificate half is exactly the
kind of change that gets waved through when it is the small half of a big diff.

**1c-i — the AuthenticationProvider.** Register a `pythonOnViya` provider so Viya
appears in the Accounts menu, with `getSessions`, `createSession`, and
`removeSession`; store one session per profile rather than one blob for all of
them; fire `onDidChangeSessions` on real transitions; set the
`pythonOnViya.authorized` context key that later `when` clauses gate on; and
resolve the account's name from `GET /identities/users/@currentUser`. Follows the
1a seam: the session model, the identity-response parse, and the decision of when
a change event is warranted are pure modules under unit test; only the provider
registration itself imports `vscode`. *Medium.*

> **The account model, settled 2026-08-13.** `account.id` is the **endpoint plus
> the Viya user id**, not the user id alone. One person with a dev deployment and
> a production deployment is two accounts, and they must be two rows in the
> Accounts menu — collapsing them means signing out of one signs out of the other,
> and worse, it means a token minted against dev is a candidate for a request to
> production. `session.id` is the profile's generated id, not its name, so
> renaming a profile does not orphan its session. Probe findings 8 and 9 pin the
> rest: key on `id` and never on `scimId` or the login name, request the
> `…identity.user.summary+json` representation so the user's address and phone
> numbers never enter the process, and read the sign-in failure out of
> `WWW-Authenticate`, because the 401 body is empty.

> **Audit, not transcription — upstream `AuthProvider.ts`.** Four things this
> slice deliberately does differently, found by reading it on 2026-08-13.
>
> 1. **All sessions live in one `SecretStorage` blob** under a single `SASAuth`
>    key, serialised together. Removing one session rewrites every other one, a
>    partial write loses all of them, and the blob grows without bound as profiles
>    come and go. One key per session, namespaced by profile id.
> 2. **`writeSession` does not await the store.** `this.secretStorage.store(...)`
>    is fired and dropped, so a window closing shortly after sign-in can lose the
>    session that sign-in just produced, and nothing surfaces the failure. Await
>    it, and let the caller see a rejection.
> 3. **Every `getSessions` call refreshes the token.** The Accounts menu polls;
>    this turns opening a menu into a network round trip and, when the refresh
>    fails transiently, into a silent session removal. Refresh against the
>    `expiresAt` that 1b-i already computes, and treat a 401 from a real request
>    as the fallback rather than the mechanism.
> 4. **`removeSession` falls back to the active profile when the id is unknown.**
>    An unrecognised id is a bug in the caller, and guessing which session was
>    meant makes it a bug that signs the user out of something they did not name.
>    Reject the unknown id.
>
> A fifth, on storage rather than upstream: the refresh token is what persists,
> the access token is held in memory for its lifetime. There is no value in
> writing a credential to disk that will be dead in an hour.

**1c-ii — private CAs and the TLS agent.** Read a user-supplied list of CA
certificate paths, build a dedicated `https.Agent` from the system roots plus
those certificates, and pass it as the `agent` 1b-ii's transport left open.
*Small.*

> **Do not port `CAHelper.ts` as written.** Upstream sets
> `https.globalAgent.options.ca`, which is process-global state in a host shared
> with every other installed extension: it changes what *they* trust, silently,
> and nothing in the extension's own tests could ever catch it. A dedicated agent
> is the same feature scoped to our own requests. And the `console.log` inside the
> `catch` around `fs.readFileSync` — named above as the example of why ported
> security code gets audited rather than transcribed — comes due here: an
> unreadable or malformed certificate path is a configuration error the user has
> to be told about, through the log channel, with the path named.

*Exit:* user can sign in to Viya and see their identity; tokens survive a reload;
signing out of one deployment leaves the other signed in; a deployment behind a
private CA reaches sign-in instead of failing at TLS; no secrets in logs.

### Phase 2 — Compute session and the backend seam

**2a — HATEOAS Compute layer.** Link following, ETag handling, session creation
with context resolution, session reconnect, and **session-death handling**:
detect a reaped or expired session, tell the user plainly that state was lost,
and recover. *Amended 2026-08-14 during 2a-ii: "offer recovery" became "recover".
A dead session is found while the user is connecting, so the offer would be a
prompt whose answer is always yes; the loss is stated in the log and a new
session is started.* Split along the same seam 1b and 1c used, for the same
reason — the pure half is unit-testable and the shell half is not:

> **2a-i — the Compute core, no `vscode` import.** The link layer (find a
> relation, resolve its `href` against the deployment origin, derive
> `Content-Type`/`Accept` from its `type`/`responseType`), the `+json` media-type
> rule, the Viya error envelope as a problem union, a request helper on 1b's
> `https.request` transport carrying `If-Match` and `If-None-Match`, context
> resolution by name, and session create / poll / delete. Unit-tested against
> fixtures scrubbed from live probes. *Medium.*
>
> **2a-ii — the VS Code shell.** Binding a session to a profile and the
> authentication provider's token, reconnect across a window reload,
> session-death detection and its recovery message, progress reporting and
> cancellation, and the output channel. The session id is persisted in
> `workspaceState` keyed by profile id, one session per workspace and profile,
> and the stored id is treated as a hint validated by use rather than a fact —
> **ADR-0012**, which also records why reclaim-by-listing was rejected after the
> probes made it possible. Integration-tested, one test per shell module.
> *Medium.*
>
> **2a-iii — one account, one command.** *Added 2026-08-15, after 2a-ii merged and
> was used by hand.* Five defects in `src/auth`, none of which the suite caught.
> Connecting must ask VS Code for the **active profile's account** rather than
> accepting whichever it is handed and then refusing it — without that, a second
> profile could not be connected to at all, which foreclosed in practice the
> multi-profile capability 2a-ii built. The refusal survives as an assertion, for
> the one case an account cannot express: two profiles pointing at the same
> deployment share an account. On top of it: *Sign In* connects, so one
> command reaches a session; the Accounts menu resolves profiles concurrently, so
> one unreachable deployment does not stall it; a cancelled sign-in is reported as
> a cancellation; and an unused stored session says why at debug. *Small.*

**The generated OpenAPI client is not vendored — see ADR-0010.** This reverses
what this plan pre-agreed. Upstream's client is 28,673 lines of which the session
layer calls twelve operations out of 136; its only transport is axios, which
ADR-0008 removed; and the wart this slice was going to fix,
`link.href.replace("/compute", "")` in `rest/common.ts`, exists *because* of the
vendoring — the service's own hrefs already carry the prefix that a generated
client's `basePath` adds a second time. Keeping the origin as the only stored
base deletes the wart's cause rather than patching its effect. Hand-writing the
used surface is 350–450 lines against 20,348.

**2-pre — Submission-mechanism probe.** *Not an implementation slice, and it must
run **before** 2b* — all three findings shape the interface 2b freezes, so probing
after it would be backwards. Settle and record in `PROBE-FINDINGS.md`:
(i) how user code containing `endsubmit;`, `%let`, and `&sysuserid` behaves when
inlined, and whether `proc python file="…"` (upload to the session filesystem) is
the injection-free submission path; (ii) whether `SYSCC` is readable from
`GET /compute/sessions/{id}/variables/SYSCC` rather than only from log text — if
not, 3a's failure detection depends on 3b and they must merge or reorder;
(iii) how to reset the Python namespace **without** destroying the compute session
— `reset()` and the cancellation fallback both depend on the answer.

**2b — `ExecutionBackend` interface + dialect layer.** Define the interface (§2.2)
including the **busy/queue contract** and `freshNamespace` semantics, `Dialect`
base with Viya 4 and 3.5 subclasses, `resolve()` with an alias registry, and
**stage-1 (HTTP-derived) capability probing only** (§2.3). Land a **minimal
`contracts/` file and checker here** and grow it per slice — contracts are built
alongside the dialect code, not retrofitted in Phase 5. No execution yet: this
slice is pure structure and its unit tests are the specification. *Medium.*

**2c — Log streaming.** Port the long-poll `getLogStream` async generators
(server-side `timeout: 10` long-poll, monotonic `start` cursor, then drain via the
`next` link to catch lines written after terminal state) and ETag state polling.
Fix the two self-recursion warts that live here, not in 2a: the uncached-state 304
recursion in `rest/job.ts::getState`, and the 412 recursion in
`rest/session.ts::cancel()` — the latter matters because 3d-i's Cancel rides on it.
*Medium.*

*Exit:* can open a compute session against a real Viya, stream its log, reconnect,
survive session death gracefully, and report stage-1 capabilities — all covered by
mocked-HTTP unit tests.

### Phase 3 — Run Python (the vertical slice)

This is the phase that makes the extension real.

**3a — `PROC PYTHON` backend.** Submission per the 2-pre findings, with **escaping
as a named deliverable** and regression tests for the injection cases. The
**submission fidelity corpus** (§4) ships in this slice, in both its unit and live
forms, and the slice is not done until every case in it round-trips byte for byte
— the quoting failures in §1.5 are silent, so the corpus is the only thing
standing between a user and a program that runs and means something else. The
**offset map** from submitted-block lines to editor lines, session options
(`PAGESIZE=MAX` to suppress page-break headers), `freshNamespace` handling, the
busy/serial contract, and success/failure detection. *Medium.*

**3b — Log filter.** SAS log → clean Python stdout: strip numbered source echo,
page-break headers, `>>>` markers, and procedure NOTEs. Pure-function, heavily
unit-tested against recorded log fixtures — including the awkward real-world cases
where a page break splits the stdout region mid-stream, and where stdout volume is
large enough to paginate.  *Medium.*

**3c — Rich output probe, then implementation.** **Probe first, per the standard
workflow.** Determine how matplotlib figures and DataFrame HTML can be returned —
candidates are writing to the session filesystem and fetching via the Compute
files API, or base64 through the log. Only after the probe settles the mechanism
do we implement `RichOutput` capture. *Unsized until the probe lands — this is the
one slice whose scope is genuinely unknown.*

**3d-i — Commands and text output.** `Run file`, `Run selection`, `Cancel`,
`Reset Python state`; output channel for streamed stdout and the raw log; progress
and status bar integration; the user-facing error surface (when to use a
notification vs the output channel vs Problems). Text-only, and **already
shippable**. *Medium.*

This slice also answers *how the user chooses Viya over the local interpreter*,
which is the question a first-time user asks before any of the above matters. The
answer is [ADR-0011](docs/adr/0011-choosing-where-python-runs.md): each workspace
has a **run target** — a profile, or Local — set from the status bar, published
as the `pythonOnViya.runTarget` context key, and used to decide whether this
extension puts a run affordance in the editor at all. It lives in
`workspaceState`, so two *different* workspaces are independent while two windows
on the same folder share one target — the same qualifier ADR-0007 states for the
active profile. When the target is Local we contribute
nothing and Microsoft's run button is the whole story; we never launch a local
interpreter, so the "no local Python" constraint stays literally true. Commands
mean what their titles say from anywhere, so the target governs *placement* and
never routing. Upstream's answer does not transfer: the SAS extension claims a
Python file only when `resourceScheme` says it was opened from Viya, which is
precisely not the file this extension exists to run. No keybinding ships in this
slice — every plausible default collides with something — so the beta gets to say
which one people reach for.

**3d-ii — Result panel webview.** The repo's first webview: build config, CSP,
host↔webview messaging, and renderers for the `RichOutput` union. Accessibility is
in scope, not deferred. *Medium.*

**3e — Runtime capability probe, and telling the user what they can import.**
Stage-2 capabilities (§2.3): interpreter version and path, installed package set,
confirmation that `PROC PYTHON` works. Needs 3a and 3b, which is why it lives here
and not in 2b. Surfaces in the status bar.

The **installed package set is a user-facing deliverable of this slice, not just a
capability record.** A developer writing Python in this extension is writing
against an interpreter they cannot see, on a machine they cannot log into, whose
package set was chosen by someone else and can change under them without notice.
Left invisible, every unavailable import is discovered as a traceback at run time
— and worse, the local environment lies convincingly, because Pylance is happily
resolving `import polars` against the packages on the *laptop*. The minimum this
slice ships is a **`Python on Viya: Show environment` command** that lists the
interpreter version, path, and installed distributions with their versions,
sourced from `importlib.metadata` rather than by shelling out to `pip`; a status
bar affordance that opens it; and a per-profile cache with an explicit refresh,
because it is a slow answer that changes rarely. Phase 10 goes further and feeds
that package set back to Pylance so completions match the remote environment;
Phase 4's traceback work should special-case `ModuleNotFoundError` and point at
this list. *Small/medium — the listing itself is small; deciding how to present a
list that can run to hundreds of entries is most of it.*

*Exit:* select Python in an editor, run it on Viya, see stdout streamed live and
rich output rendered. **This is the first genuinely useful build.**

### Phase 4 — Diagnostics

**4a — Traceback parsing.** Parse the traceback, discard `<stdin>` harness frames,
map `<string>` frames through the offset map to editor positions. *Medium.*

**4b — Diagnostics surface.** Publish `Diagnostic`s into the Problems panel with
correct squiggle positions; clear on re-run; optional quick actions. *Small/medium.*

*Exit:* a failing Python run puts an accurately-positioned error in Problems.

### Phase 5 — Hardening and first release

**5a — Drift gate hardening.** The contracts themselves grew alongside the dialect
code from 2b onward; this slice completes them, hardens the
contracts ↔ dialect ↔ fixtures checker, and wires it into CI as a gate. *Small/medium.*

**5b — Live test tier.** Opt-in, env-gated live tests (`PYTHON_ON_VIYA_TEST_VIYA4_*` /
`PYTHON_ON_VIYA_TEST_VIYA35_*`), with the 3.5 tier as a skipped scaffold. Nothing live runs in
default CI. *Medium.*

**5c — Docs publishing and release engineering.** The docs themselves were written
slice by slice (§4.1); this slice *publishes* them — docs site build and deploy,
marketplace metadata and README rendering, screenshots/GIFs, the troubleshooting
guide assembled from what actually went wrong during Phases 1–4, publishing
workflow (VS Marketplace + Open VSX), and the release checklist. *Medium.*

*Exit:* **v0.1.0 published.** A user can install from the marketplace and run
Python on Viya.

---

Everything above is the product. Everything below is breadth, and each phase is
independently valuable and independently shippable. Order is a recommendation,
not a dependency chain — reprioritise based on what users actually ask for once
v0.1.0 is in their hands.

### Phase 6 — SAS Content explorer

`ContentAdapter` interface and the Viya REST implementation over `/folders` and
`/files`; `TreeDataProvider`; `FileSystemProvider` registration so remote `.py`
files open and save in place; drag/drop; favourites; recycle bin. Largely
language-agnostic and ports closely. *Slices: 6a adapter + read-only tree;
6b open/save via FileSystemProvider; 6c mutations (create/rename/move/delete);
6d favourites and recycle bin.*

### Phase 7 — Libraries and data viewer

`LibraryAdapter` over Compute's `DataAccessApi`, library/table tree, and the
paged data viewer. The SAS extension's React/ag-grid panel is polished and
transfers. *Slices: 7a adapter + tree; 7b data viewer; 7c sort/filter/CSV export.*

### Phase 8 — CAS and SWAT

Genuinely net-new — the SAS extension calls no CAS APIs. `swat` is already
installed on the deployment (`PROBE-FINDINGS.md`), so the client side is free.
CAS server/caslib/table browsing via `/casManagement`, and a documented pattern
for getting an authenticated CAS session inside a Python cell without the user
handling credentials. *Slices: 8a CAS browsing; 8b authenticated CAS session
helper; 8c CAS tables in the data viewer.*

### Phase 9 — Notebooks

`.py`-first notebook support with a `NotebookController` reusing the same session
(so state is shared between notebook and editor, exactly as the SAS extension
does). **Decide early: ipynb-compatible or a bespoke format?** The SAS extension
chose bespoke `.sasnb`; for Python, ipynb compatibility is worth serious weight
because the ecosystem expects it. *Slices: 9a format decision + serializer;
9b controller + execution; 9c renderers; 9d export.*

### Phase 10 — Viya environment awareness

Phase 3e already ships the honest answer to "what can I import?" — a command that
lists the interpreter version, path, and installed distributions. This phase makes
that answer *ambient* rather than something you have to go and ask for: a proper
environment view with search and filtering, a diff against the local environment
so the mismatch that will bite is visible before it does, and reflecting the
remote package set back to Pylance so completions and unresolved-import warnings
describe the environment the code will actually run in rather than the laptop's.
Package *installation* into the compute context is deliberately deferred — it
raises governance questions that need a product decision first. *Slices:
10a environment view and local/remote diff; 10b Pylance environment reflection.*

### Phase 11 — Remaining parity gaps

The long tail that Phases 6–10 don't cover (§3.1): session startup/autoexec
configuration, result panel styling options, snippets for common Viya patterns,
and any localisation bundles beyond English. Individually small, collectively the
difference between "works" and "feels like a peer of the SAS extension."
*Slices sized when the phase is reached.*

### Phase 12 — Second execution backend

Only if warranted. The `ExecutionBackend` seam exists so this is additive. Revisit
native Python runtimes (SAS Workbench, batch/job execution) once real usage shows
where `PROC PYTHON` actually hurts.

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

**Fixtures are per-generation** (`test/fixtures/viya4/`, `test/fixtures/viya35/`),
captured from real responses and **sanitised of hostnames, tokens, and personal
data**. The viyapy generation-parameterised fixture idiom applies: happy paths run
once per generation so a dialect regression fails loudly.

**Live tests are gated three ways**: an opt-in npm script, per-generation env vars
(`PYTHON_ON_VIYA_TEST_VIYA4_URL` / `_TOKEN` / …), and a separate
`PYTHON_ON_VIYA_ALLOW_MUTATION` flag for anything that writes to the deployment. Mutating tests are self-cleaning with
per-run unique names and cleanup in `finally`.

**Coverage** starts at a threshold the Phase 0 harness actually meets and ratchets
upward per phase; the target is ≥85% on `connection/`, `dialects/`, and `python/`.
Ratcheting beats an aspirational gate that gets disabled the first time it blocks
a release.

**The submission fidelity corpus** is a named test asset, introduced with Phase 3a
and maintained forever after. It is a directory of real Python programs chosen to
be hostile to SAS tokenisation — apostrophes in comments and docstrings, an odd
number of quotes in a line, triple-quoted strings containing both quote styles,
f-strings with nested quotes and braces, raw and byte strings, `&` and `%` in
string literals, the literal token `endsubmit;` inside a comment and inside a
string, a `;`-heavy one-liner, CRLF line endings, a tab-indented file, non-ASCII
identifiers and string content, an empty file, and a file with no trailing
newline. Each one is asserted **byte for byte** at the far end, and the assertion
is on what the interpreter received, not on what we sent.

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

**`PROBE-FINDINGS.md` is the evidence base and is versioned.** Each probe slice
(`2-pre`, `3c`, `3e`) appends dated findings. When a finding is superseded, it is
struck through with the date and reason rather than deleted — a claim that quietly
changed is worse than one that visibly changed.

**Honesty gate.** Docs may not claim Viya 3.5 support while it is unverified (§1.4),
may not document a capability the runtime probe can't confirm, and must state
plainly that no telemetry is collected. Anything aspirational belongs in the
roadmap section, labelled as such.

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
| **`endsubmit;` / macro injection** in submitted Python | **High — correctness + security** | 2-pre probe; `proc python file=` if inlining is unsafe; escaping tests in 3a |
| Rich output has no clean return path | High — reshapes Phase 3 | Probe (3c) before writing rendering code; `print`-only is an acceptable v1 floor |
| Namespace reset requires killing the session | Medium — degrades cancel *and* Run File | 2-pre probe; if true, redesign `reset()` and say so in the UI |
| Session dies mid-run / state lost on reconnect | Medium | Explicit detection and messaging in 2a; fixture-driven tests |
| `PROC PYTHON` absent on Viya 3.5 | Medium | Capability probe degrades gracefully; docs make no unverified claim |
| Compute cancellation doesn't interrupt a running Python step | Medium — bad UX | Probe after 3d-i; fall back to session reset with a clear message |
| Phase 2a exceeds a reviewable PR | Medium | Pre-agreed split at the generated-client boundary |
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
    be live. Executed in 3d-i.

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
reviewers are also pointed at `PROBE-FINDINGS.md` and instructed to flag any claim
about Viya behaviour the evidence file doesn't support — which makes the probe
document machine-enforced rather than merely well-intentioned.

What remains for 0a-ii is only the merge and the smoke test.

---

## 8. Definition of done

v0.1.0 ships when: the extension installs from the marketplace and activates
cleanly on Windows, macOS, and Linux; a user can create a Viya connection profile,
authenticate via OAuth2/PKCE, and run a `.py` file or selection on Viya; stdout
streams live and errors appear as accurately-positioned diagnostics; no local
Python is required; unit tests cover every public path including error branches
with no network in default CI; the live tier passes against a real Viya 4 and the
3.5 scaffold is present and skipped; CI is green across lint, type-check, test,
security, and drift; the licence is consistent with everything we bundle and the
`NOTICE` is complete; the workspace-trust posture is declared and enforced;
**no telemetry is collected, and the marketplace listing says so**; the docs site
builds clean with no broken links and its generated reference matches source, and
describes setup and limitations honestly — including that 3.5 is unverified; every
settled §6 decision has an ADR; and no secrets appear anywhere in the repo or logs.
