// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ComputeClient,
  type ComputeResult,
  createComputeClient,
} from "../../src/compute/client";
import { resolveContext } from "../../src/compute/contexts";
import { createFileref, writeFilerefContent } from "../../src/compute/fileref";
import { findLink } from "../../src/compute/links";
import { type ComputeProblem } from "../../src/compute/problems";
import {
  type ComputeSession,
  createSession,
  deleteSession,
  SESSION_NAME,
  waitWhilePending,
} from "../../src/compute/session";
import { liveTarget, requireMutation } from "../helpers/live-gate";
import { listFixtureFiles, readFixtureBytes } from "../helpers/fixtures";

/** Overrides `DEFAULT_CONTEXT`, matching `viya4-job.test.ts`'s own variable. */
const CONTEXT_VAR = "PYTHON_ON_VIYA_TEST_VIYA4_CONTEXT";
const DEFAULT_CONTEXT = "SAS Job Execution compute context";

const CORPUS_DIR = "submission-corpus";

/**
 * A curated subset of the submission-fidelity corpus, round-tripped through a
 * real Viya 4 deployment.
 *
 * `test/unit/submission-corpus.test.ts` drives every case through a real
 * `ComputeClient` over a recording transport, and proves the bytes reach that
 * transport unchanged. This is the different claim `viya4-job.test.ts`'s own doc
 * comment makes about itself: the unit tier proves the module reads a recorded
 * response correctly, and this proves a real deployment's responses are still
 * the ones that were recorded. Findings 35, 36 and 57 are what is being
 * re-checked.
 *
 * **Five cases, not all fourteen**, because each one costs a fileref create, a
 * `GET` for its `ETag`, a content `PUT`, and a content `GET` — four requests
 * against a real deployment per case. The five here were picked to be maximally
 * distinct rather than maximally numerous: CRLF line endings, non-ASCII content,
 * a genuinely empty file, a file with no trailing newline, and one
 * quote-heavy case standing in for the rest of the tokenisation-hostile group,
 * which the unit tier already covers exhaustively against the recorded shape.
 *
 * **What this does not prove — the read-back path.** `ComputeResponse.text` is
 * a decoded string: `transport.ts` reads every response through Node's UTF-8
 * decoder, and nothing in this project's client exposes a raw response body. So
 * the read-back side of this round trip is only as byte-faithful as UTF-8
 * decode-then-re-encode, which is lossless for well-formed UTF-8 text and is not
 * a claim about arbitrary binary. That is an honest description of this corpus's
 * scope, not a gap being papered over: every case is real Python *source*, which
 * is well-formed UTF-8 by construction, and 3a has never proposed uploading
 * anything else.
 *
 * **What this does not prove — the interpreter.** Nothing here runs any Python
 * at all. This suite ends at "the deployment stored the bytes and handed them
 * back"; that `proc python infile=<fileref>;` then *reads* those same bytes,
 * that the interpreter sees the file the way the editor held it, and that a
 * `\r\n` or a missing final newline does not change what executes, are all
 * unproved by every tier of this corpus. They land with slice **3a**, which is
 * the slice that first composes the `infile=` statement and reads a log back —
 * and the corpus is the thing 3a will be checked against, not a substitute for
 * it. Finding 31 is why the distinction is worth stating rather than assuming:
 * the mechanism this replaced failed *silently*.
 *
 * **If every case here fails with `compute-unreachable`, look locally first.**
 * That is what a TLS or proxy problem on *this* machine looks like from here,
 * and on 2026-08-19 it cost hours of looking at Viya: the deployment presents a
 * leaf certificate with no intermediate, so Node cannot build a chain and no
 * request leaves the process. `describeFailure` deliberately does not print the
 * underlying message — see its own comment for why — so the cause is in
 * RUNBOOK **P33** instead, along with the `NODE_OPTIONS=--use-system-ca` that
 * fixes it. A deployment that is actually down fails the connectivity suite
 * too; a local trust problem fails that one in the same way, which is the point
 * of running it first.
 */
const CURATED_CASES: readonly string[] = [
  "crlf-line-endings.py",
  "non-ascii.py",
  "empty.py",
  "no-trailing-newline.py",
  "triple-quote-mixed-styles.py",
];

describe("live: Viya 4 submission-fidelity corpus (upload round trip)", function () {
  const target = liveTarget("viya4");
  const contextName = process.env[CONTEXT_VAR] ?? DEFAULT_CONTEXT;

  // Four requests per case, five cases, generous per-request headroom rather
  // than a tuned figure — there is no long poll on this path at all, unlike
  // `viya4-job.test.ts`'s session and log waits.
  this.timeout(120_000);

  let client: ComputeClient | undefined;
  let session: ComputeSession | undefined;

  before(function () {
    if (!target?.allowMutation) {
      this.skip();
      return;
    }
    client = createComputeClient({
      root: target.baseUrl,
      token: () => target.token,
    });
  });

  after(async function () {
    if (client === undefined || session === undefined) return;
    const doomed = session;
    session = undefined;
    const result = await deleteSession(client, doomed);
    if (!result.ok) {
      console.warn(
        `live: the compute session was not deleted (${describeFailure(result.problem)}); look for a session named "${SESSION_NAME}" on the deployment`,
      );
    }
  });

  it("has the fixtures this run assumes exist", () => {
    // Guards against the unit tier's corpus and this file's curated subset
    // drifting apart silently — a case renamed in one place and not the other
    // would otherwise fail this suite as "fixture not found" with no hint why.
    const all = listFixtureFiles(CORPUS_DIR);
    for (const name of CURATED_CASES) {
      assert.ok(all.includes(name), `${name} is not in the corpus directory`);
    }
  });

  for (const name of CURATED_CASES) {
    it(`uploads and reads back ${name} byte for byte`, async function () {
      if (!target || client === undefined) {
        this.skip();
        return;
      }
      requireMutation(target);
      const compute = client;

      // A local, narrowed copy rather than re-reading the outer `session` below:
      // that `let` is a `describe`-scoped variable the `after` hook also reads,
      // and — the same reason `viya4-job.test.ts` keeps its own `ready` local —
      // the compiler's narrowing of a closed-over `let` should not be leaned on
      // across an `await`, even where it happens to hold today.
      let active: ComputeSession;
      if (session === undefined) {
        const resolved = await expectOk(
          resolveContext(compute, contextName),
          (failure) =>
            `the compute context "${contextName}" could not be resolved (${failure})`,
        );
        // Not a `ComputeFailure`: an empty `items` array is a legitimate
        // absent value now (see `contexts.ts`), and this fixture is the
        // caller that decides what an absent context means for it — here,
        // that the fixture itself is misconfigured.
        if (resolved === undefined) {
          assert.fail(
            `no compute context named "${contextName}" was returned by the deployment`,
          );
        }
        const context = resolved;
        const created = await expectOk(
          createSession(compute, context),
          (failure) =>
            `could not start a session in "${contextName}" (${failure})`,
        );
        session = created;
        active = await expectOk(
          waitWhilePending(compute, created),
          (failure) => `the session never became usable (${failure})`,
        );
        session = active;
      } else {
        active = session;
      }

      const source = readFixtureBytes(CORPUS_DIR, name);
      // A short, SAS-fileref-safe name — `name` itself carries dots and dashes
      // a fileref name has never been tested with, and this file's job is the
      // upload path's fidelity, not fileref-naming rules 3a has not designed
      // around yet.
      const filerefName = `case${String(CURATED_CASES.indexOf(name) + 1)}`;

      const fileref = await expectOk(
        createFileref(compute, active, filerefName),
        (failure) =>
          `the fileref "${filerefName}" was not created (${failure})`,
      );

      await expectOk(
        writeFilerefContent(compute, fileref, source),
        (failure) =>
          `the content of "${filerefName}" was not written (${failure})`,
      );

      const contentLink = findLink(fileref.links, "content");
      if (contentLink === undefined) {
        assert.fail(
          `the fileref "${filerefName}" carried no "content" relation to read back`,
        );
      }

      const read = await expectOk(
        compute.send({ link: contentLink }),
        (failure) =>
          `the content of "${filerefName}" could not be read back (${failure})`,
      );

      // The read reached the content resource and it answered. Worth its own
      // line because of `empty.py`: a zero-length comparison below is satisfied
      // by an empty string from *any* source, so for that one case the status
      // is most of what distinguishes "the deployment stored nothing and said
      // so" from "the deployment stored nothing and this test noticed nothing".
      // It is not a complete discriminator — a fileref whose content was never
      // written would presumably also read back empty — and no probe has
      // measured that case, so the empty file is the weakest of the five and is
      // recorded here as such rather than dropped.
      assert.equal(read.status, 200);

      // See this file's own doc comment: the read side is a decoded string,
      // so the comparison is against the source re-encoded through the same
      // UTF-8 path rather than against its raw bytes directly.
      const gotBytes = Buffer.from(read.text, "utf8");
      const wantBytes = Buffer.from(source);
      assert.equal(
        gotBytes.length,
        wantBytes.length,
        `"${name}" round-tripped to a different length (sent ${String(wantBytes.length)} bytes, read back ${String(gotBytes.length)})`,
      );
      assert.equal(
        gotBytes.equals(wantBytes),
        true,
        `"${name}" did not round-trip byte for byte`,
      );
    });
  }
});

/**
 * Unwraps a {@link ComputeResult}, failing with the message the caller
 * composes. Same shape as `viya4-job.test.ts`'s helper of the same name, and
 * for the same reason — `assert.equal(result.ok, true)` does not narrow the
 * union, so the alternative at every call site would be a non-null assertion.
 */
async function expectOk<T>(
  result: ComputeResult<T> | Promise<ComputeResult<T>>,
  onFailure: (failure: string) => string,
): Promise<T> {
  const settled = await result;
  if (!settled.ok) {
    assert.fail(onFailure(describeFailure(settled.problem)));
  }
  return settled.value;
}

/**
 * A live failure, in the only terms this tier is allowed to print.
 *
 * The discriminant and the HTTP status, and deliberately nothing else — see
 * `viya4-job.test.ts`'s copy of this function for the full argument, including
 * why `problem.detail` was tried here on 2026-08-20 and rejected: it carries a
 * live session id on the `compute-unreachable` path and an internal hostname on
 * a DNS failure.
 */
function describeFailure(problem: ComputeProblem): string {
  return "error" in problem
    ? `${problem.code}, HTTP ${String(problem.error.status)}`
    : problem.code;
}
