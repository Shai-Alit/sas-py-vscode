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

## Tier three — live

Opt-in, and gated three separate ways.

1. **The script.** Only `npm run test:live` points Mocha at `test/live/`, using
   `.mocharc.live.json`. `npm run verify` cannot reach a real server no matter
   what is in the environment. (The config file exists rather than a `--spec`
   flag because `--spec` does not replace the `spec` in `.mocharc.json` — Mocha
   merges them, and the live run would quietly execute the unit suite too.)
2. **Per-generation environment variables.** `PYTHON_ON_VIYA_TEST_VIYA4_URL` and
   `PYTHON_ON_VIYA_TEST_VIYA4_TOKEN`, or the matching `..._VIYA35_...` pair. The
   names are prefixed on purpose: these live in a developer's shell, not in a
   config file scoped to this repository, and a bare `ALLOW_MUTATION` exported
   for some other project would silently open this one's write gate. A test whose
   generation is not configured skips itself rather than failing — a tier that
   fails when it is not set up gets disabled, and a disabled tier never runs
   anywhere. The URL must be `https://`; the gate refuses to send a bearer token
   over plaintext.
3. **`PYTHON_ON_VIYA_ALLOW_MUTATION=1`**, checked separately by
   `requireMutation`. Read access and write access are different decisions: pointing the suite at a shared
   deployment to read from it should not also grant permission to create objects
   there. Mutating tests owe that deployment per-run unique names and cleanup in
   a `finally`.

The gate itself is unit-tested — `test/unit/live-gate.test.ts` — including every
refusal path, because it is the one piece of test infrastructure that can cause
damage when it is wrong.

**Never log a token.** Not in an assertion message, not in a failure dump, not
in a fixture. A live failure message may name the endpoint and the status code
and nothing else; the response body carries a real user's identity.

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

`viya4/` and `viya35/` hold captures from real deployments and nothing else.
`viya35/` is empty, and honestly so: this project has not yet talked to a live
Viya 3.5. A payload invented from documentation looks identical to a recorded one
and is worth much less, with no way to tell them apart six months later. If you
need a shape you cannot capture, put it in `harness/` and say in the file what it
is.

## Coverage, and the ratchet

`npm run coverage` runs the unit tier under c8 and fails if coverage drops below
the thresholds in `.c8rc.json`. It is part of `npm run verify`, so it is part of
every push.

The rule that makes this work is the ratchet: **a slice that adds code to `src/`
raises the thresholds in the same pull request, to just under whatever the suite
then measures.** Run `npm run coverage`, read the summary table, round down,
commit the new numbers. Thresholds go up and never down; lowering one is a
decision that belongs in a pull-request description, argued for explicitly.

They started at zero, which was the honest number while the only shipped module
was the activation entry point: it imports `vscode`, so it cannot be loaded
outside an extension host, and c8 cannot see inside the process the integration
tier runs in. Slice 1a raised them for the first time, to 55% of lines and
statements, 63% of functions and 86% of branches.

**Round down further than feels necessary.** The gate runs on Linux, Windows and
macOS, and a threshold set to the last decimal on one of them will eventually
fail on another for a reason that has nothing to do with the change under review.
A point or two of slack costs nothing; a red build nobody can reproduce costs an
afternoon.

Expect the whole-tree percentage to move in both directions as the shape of the
code changes, because it is one number over two very different populations. The
profile model is at 98% because it is pure and the unit tier can reach it; the
store, the commands and the status bar sit at zero in that column because they
import `vscode` and are exercised in the extension host instead. A slice that
adds a large shell and a small model will push the aggregate down even though it
is well tested, and the ratchet then has to be argued for in the pull request
rather than mechanically raised. That is the intended conversation, and it is why
the split in `src/profile/` puts as much as possible on the side the number can
see.

Excluding a file to make the number look better is the failure mode to avoid.
Hard-to-test code is exactly the code the number is supposed to be telling you
about. The one sanctioned exclusion is vendored generated OpenAPI clients, which
are not authored here and are covered by the tests of the code that calls them.

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
- **`error while loading shared libraries` from the integration tier** — the
  editor is a real GUI application and needs the X and GTK libraries even when
  it is running headless under a virtual display. A minimal container will not
  have them. This is a property of the environment, not of the suite.
