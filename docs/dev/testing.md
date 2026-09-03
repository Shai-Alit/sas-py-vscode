# Testing

Three tiers, in descending order of how often you should be writing in them.
`CONTRIBUTING.md` holds the rules; this page explains how the machinery works
and why it is shaped this way.

```bash
npm run test:unit          # mocked HTTP, no network, no VS Code
npm run test:integration   # a real VS Code, mocked Viya
npm run test:live          # opt-in, env-gated, a real deployment
npm run coverage           # the unit tier under c8, with the ratchet enforced
```

Nothing here proves a person can install the packaged `.vsix`, point it at a
deployment, and get a figure back. That is the [manual test
pass](manual-test-pass.md) — a scripted walkthrough run by hand before a release
and when a phase closes.

## The stack, and what is deliberately missing

Mocha as the runner, `node:assert/strict` for assertions, Sinon for fakes and
fake timers, [msw](https://mswjs.io) at the HTTP boundary, and c8 for coverage.

No assertion library. `node:assert/strict` is already in the runtime, its
`deepEqual` is the strict one, and it removes a dependency from a project whose
premise is that you install nothing. Chai 6 is ESM-only, which would have forced
either an ESM split or a pin to an old major; neither was worth paying for
`expect(x).to.equal(y)`.

No `ts-node` or transpiler hook. `npm run compile:test` runs `tsc` over
`tsconfig.test.json` and Mocha runs the JavaScript that comes out. That is one
more step, but it is the same JavaScript the extension host would load, and it
removes the whole class of bug that passes under a transpiler and fails when
bundled. Node's own `--enable-source-maps` puts the `.ts` line back in the stack
trace.

Two TypeScript projects, not one. `tsconfig.json` compiles the extension and
knows nothing about `test/`; `tsconfig.test.json` compiles both and adds Mocha's
globals. If `describe` and `it` were in scope while writing `src/`, a test-only
import could reach into production code and nothing would complain until someone
loaded the extension.

## Tier one — unit

The bulk of the suite. No network, no VS Code, no disk beyond reading a fixture.
Mocha's timeout here is two seconds, because a unit test that takes longer than
that is not slow, it is stuck, and a generous timeout only delays the diagnosis.

One test raises its own timeout: `eslint-ignores.test.ts` constructs ESLint,
which loads the flat config and with it the whole typescript-eslint module
graph. If you find yourself reaching for `this.timeout()` a second time, check
first that the test is not quietly doing I/O it should be mocking — the
exemption is for loading a tool, not for waiting on one.

Mock at the HTTP boundary, never by copying the logic under test into the test.
This is the rule most likely to get a change rejected, and it comes from a real
defect: the upstream SAS extension reimplements its REST logic inside its REST
tests, with the result that the layer is effectively untested and the copy is
free to drift from the thing it claims to describe.

```ts path=test/unit/compute-contexts.test.ts
import { http } from "msw";
import {
  fixtureResponse,
  MOCK_VIYA_BASE,
  mockViya,
} from "../helpers/mock-viya";

describe("compute contexts", () => {
  const viya = mockViya(
    http.get(`${MOCK_VIYA_BASE}/compute/contexts`, () =>
      fixtureResponse(["viya4", "compute-contexts.json"], {
        contentType: "application/vnd.sas.collection+json",
      }),
    ),
  );

  it("gives up on a 503 instead of retrying forever", async () => {
    viya.use(
      http.get(`${MOCK_VIYA_BASE}/compute/contexts`, () =>
        fixtureResponse(["viya4", "error-503.json"], { status: 503 }),
      ),
    );
    // ...
  });
});
```

Call `mockViya` inside a `describe` body. Called at module scope its hooks
become Mocha root hooks and apply to every suite in the run.

**Unmocked requests fail.** `onUnhandledRequest: "error"` is the point of the
helper, not a detail of it: mocking at the boundary only buys something if a
forgotten handler is a failure rather than a silent escape to the network.
`test/unit/http-mocking.test.ts` proves this against a real HTTP server on
loopback, and that detail matters — the obvious version of that test, asserting
that a request to a `.invalid` host rejects, passes whether the mock layer
refuses it or not, because the fetch dies at DNS either way. It asserts nothing.
A loopback server that genuinely answers `200` is the only way to tell "refused
by the mock layer" from "could not reach the network".

**The one place msw is the wrong tool.** `test/unit/auth-transport.test.ts` also
runs against a real server on loopback, for the same reason inverted: its subject
*is* the transport. msw intercepts `ClientRequest`, so mocking there would
substitute for the code under test — the module selection between `node:http` and
`node:https`, a socket destroyed part-way through an oversized body, an abort
listener that has to be removed exactly once. A green suite would prove almost
nothing. This is not a licence to reach for a server elsewhere: the test is
still hermetic, still inside the two-second timeout, and the rule remains that
anything above the transport mocks at the HTTP boundary.

## Tier two — integration

`@vscode/test-electron` downloads a real VS Code, launches it with the extension
loaded from source, and runs Mocha inside the extension host. This is the only
tier that can prove the extension *loads*: bundling, `main`, `engines`, the
activation contract, and command registration are invisible to the unit tier and
uncheckable by the compiler.

It is two halves. `test/integration/runTest.ts` runs in a plain Node process and
launches the editor; `test/integration/index.ts` runs inside it, where
`require("vscode")` resolves. Keep this tier small — it is slow, it needs a
display, and everything that can be proven one tier down should be.

**Reusing an editor you already have.** The download is cached in
`.vscode-test/`, keyed by version *and platform*, and that location is not
configurable. A checkout shared between two platforms — a Windows working tree
opened from a Linux container, a warm CI cache, a metered connection — therefore
pays 330 MB again for the second platform on every clean run. Setting
`PYTHON_ON_VIYA_TEST_VSCODE` to an extracted VS Code directory, or to the
executable inside it, skips the download:

```bash
PYTHON_ON_VIYA_TEST_VSCODE=/tmp/vscode-linux-x64-1.133.0 npm run test:integration
```

Unset it and nothing changes, which is the case in CI today. A path that does
not exist is an error rather than a fallback: falling back would perform exactly
the download the variable exists to avoid, silently, on a typo. The launched
editor still gets the throwaway `--user-data-dir` and `--extensions-dir` that
`runTests` derives, so pointing this at an editor you use daily cannot touch
your real settings or extensions. Its version is not checked against what the
harness would have downloaded — if a result here disagrees with CI, that is the
first thing to suspect, and the path is printed on every run for that reason.

Discovery is recursive, so a suite may live in a subdirectory. That is asserted
rather than assumed: `discoverTestFiles` is exported and tested from the unit
tier against real nested directories, because a discovery bug does not announce
itself — tests that are never found look exactly like tests that pass.

Viya is still mocked here. A test that needs a real deployment belongs in tier
three.

**Do not create and dispose host singletons per test.** The host caches some
objects under the name you asked for, and a log channel is one of them: its name
becomes a logger id and a log file, so disposing one and creating another by the
same name hands you back the cached, already-disposed logger. From then on every
write to it throws `Channel has been closed`, and the failures land on whichever
test logs next rather than on the `afterEach` that caused them — with stack frames
pointing into the code under test, which is a convincing wrong answer. Take
host-owned things once, at suite or module scope, and let the host tear them down
when the run ends; that is also what an extension does, since `activate` creates
its channel once. `testLogChannel` in `test/helpers/auth-host.ts` does this for
you. Dispose only what the test itself made — an `EventEmitter`, a
`CancellationTokenSource`, your own registrations.

## Tier three — live

Opt-in, hits a real Viya, never in default CI, and gated three separate ways:

1. **The script.** Only `npm run test:live` points Mocha at `test/live/`, via
   `.mocharc.live.json`. `npm run verify` cannot reach a real server no matter
   what is in the environment — the spec globs do not overlap.
2. **Per-generation environment variables.** `PYTHON_ON_VIYA_TEST_VIYA4_URL` +
   `PYTHON_ON_VIYA_TEST_VIYA4_TOKEN` — the only generation, since ADR-0022. A
   generation with neither set skips; a half-configured pair throws; the URL
   must be `https://`.
3. **`PYTHON_ON_VIYA_ALLOW_MUTATION=1`**, checked separately by
   `requireMutation` at the first write in every mutating suite. Read access and
   write access are different decisions.

The gate itself is unit-tested — `test/unit/live-gate.test.ts` — including every
refusal path, because it is the one piece of test infrastructure that can cause
damage when it is wrong.

Two rules carry from this tier into any suite added to it. A failure message
**names the endpoint and the status code and nothing else** — never the
`ComputeProblem.reason` beside it, which on the rejected path carries the
deployment's own sentence (session id included). And **a live test is only wrong
against a live deployment**, so it should *import* the paths and media types it
exercises from the code under test rather than restate them — the interval
between writing one and first running it is the interval in which it is
unverified, and `viya4-connectivity.test.ts`'s own first run on 2026-08-19
failed on exactly such a restated media type ([finding
6](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases/phase-1.md#finding-6-the-obvious-media-type-is-wrong-and-wrong-is-a-406)).

**Running it — the env vars in full, the CA-certificate case, what each suite
costs the deployment, the cleanup contract for mutating tests, and the 5b
coverage audit — is its own page: [The live test tier in
anger](live-testing.md).** Read it before adding a suite.

## Fixtures

Everything the unit tier knows about Viya, it learned from a file under
`test/fixtures/`. Capture, sanitise, and commit — the procedure is in
[test/fixtures/README.md](https://github.com/Shai-Alit/sas-py-vscode/blob/main/test/fixtures/README.md), and it is worth reading
before your first capture rather than after.

Two things to know now. Fixtures are read from the source tree and never copied
into `out/`, so there is no build step to forget and no stale copy to go green
against. And `fixtureResponse` serves the recorded bytes rather than parsing and
re-serialising them, so key order, number formatting, and whitespace reach the
code under test exactly as the server sent them.

`viya4/` holds captures from real deployments and nothing else. A payload
invented from documentation looks identical to a recorded one and is worth much
less, with no way to tell them apart six months later. If you need a shape you
cannot capture, put it in `harness/` and say in the file what it is.

A `viya35/` sibling existed until [ADR-0022](../adr/0022-drop-viya-35-support.md)
dropped Viya 3.5 support — it stayed empty for the same reason: this project
never talked to a live Viya 3.5.

## Coverage, and the ratchet

`npm run coverage` runs the unit tier under c8 and fails if coverage drops below
the thresholds in `.c8rc.json`. It is part of `npm run verify`, so it is part of
every push.

The rule that makes this work is the ratchet: **a slice that adds code to `src/`
raises the thresholds in the same pull request, to just under whatever the suite
then measures.** Run `npm run coverage`, read the summary table, round down,
commit the new numbers. Thresholds go up and never down; lowering one is a
decision that belongs in a pull-request description, argued for explicitly.

**Round down further than feels necessary.** The gate runs on Linux, Windows and
macOS, and a threshold set to the last decimal on one of them will eventually
fail on another for a reason that has nothing to do with the change under review.
A point or two of slack costs nothing; a red build nobody can reproduce costs an
afternoon.

### What the number is measured over

It is **unit-reachable coverage**, not whole-tree coverage. Modules that import
`vscode` are excluded from the denominator, because a module that imports
`vscode` cannot be loaded outside an extension host: it scores zero however well
it is tested, and the integration tier that does test it runs in a process c8
cannot see into. Leaving those modules in would make the aggregate one number
over two incompatible populations, and a slice that added a large shell and a
small model would push it down while increasing the amount of tested code.
[ADR-0009](../adr/0009-coverage-scope.md) has the full argument and the options
that were rejected.

Excluding a file to make the number look better is still the failure mode to
avoid — hard-to-test code is exactly the code the number is supposed to be
telling you about. What separates the two cases is that this exclusion is a
**rule, and the rule is checked**. `npm run check:coverage-scope` asserts, on
every `npm run verify`:

- every `src/` path in the c8 `exclude` list really is unreachable from the unit
  tier, so a merely inconvenient module cannot be parked there; and
- every module that is unreachable is in the list, so a new shell module cannot
  quietly sink the aggregate.

There are two ways to be unreachable. Importing `vscode` is the first. The
second, added 2026-08-16, is a file of nothing but types: it compiles to an empty
JavaScript file, so no test can execute a line of it, while c8 charges its whole
source — doc comments and all — to the denominator. `src/backend/backend.ts` is
the first of these. A file qualifies only while *every* top-level statement in it
is erased at compile time, so the day one grows a helper it goes back in the
denominator and the check says so by name.

Globs are refused in the `src/` part of the list, since `src/**` would satisfy
the first assertion only by leaving nothing to disagree with it. The import test
is TypeScript's parser rather than a text search, which matters twice over:
comments in `src/` discuss importing `vscode` and a regex reports the prose, and
`import type { Uri } from "vscode"` is erased before the code runs — a module
that imports only types is unit-testable and keeps its floor — unless types are
*all* it contains, which is the second rule above.

So adding a shell module is a two-line change: the module, and its path in
`.c8rc.json`. Forget the second line and `verify` fails with a message naming the
file.

### What the number does not cover

Nothing now watches the shell. That guarantee is a process gate instead: **a
slice that adds a shell module adds an integration test for it**, because after
the exclusion no threshold will notice if it doesn't. That is the price of the
decision, and it is worth naming plainly — a check a human has to remember is
weaker than one a machine performs.

The split in `src/profile/` is what keeps that price small. As much logic as
possible lives on the side the unit tier can reach: `import.ts` and `model.ts`
are pure and sit near 98%, while `store.ts`, `commands.ts` and `statusBar.ts`
hold only the parts that genuinely need the host. Widen the shell and you move
code out from under the number.

## When something fails and you cannot see why

- **`No test files found`** — `npm run compile:test` has not run, or has failed.
  Mocha runs `out/`, not `test/`.
- **A test passes alone and fails in the suite** — a handler leaked. `mockViya`
  resets handlers after every test; a `server.use()` outside a test does not get
  reset.
- **`[MSW] Error: intercepted a request without a matching request handler`** —
  usually a real bug, occasionally the assertion passing. In
  `test/unit/http-mocking.test.ts` it is the latter, and says so.
- **A stack trace points at `.js`** — the source map did not load. Check that
  `node-option: ["enable-source-maps"]` survived in `.mocharc.json`.
- **More tests ran than the branch has** — `out/` is not cleaned when you switch
  branches, and Mocha runs `out/`. Tests from the branch you left are still
  there, passing, and inflating the count. `rm -rf out && npm run test:unit`.
- **`Channel has been closed`, thrown from inside the code under test** — a log
  channel was disposed and one by the same name created afterwards. The test that
  fails is not the test that broke it; look for `Trying to add a disposable to a
  DisposableStore that has already been disposed of` earlier in the output, which
  is where it actually happened. See tier two above.
- **`error while loading shared libraries` from the integration tier** — the
  editor is a real GUI application and needs the X and GTK libraries even when
  it is running headless under a virtual display. A minimal container will not
  have them. This is a property of the environment, not of the suite.
