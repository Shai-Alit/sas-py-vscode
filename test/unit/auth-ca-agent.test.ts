// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { Agent, globalAgent } from "node:https";
import { rootCertificates } from "node:tls";

import { buildCaAgent } from "../../src/auth/caAgent";

/**
 * `buildCaAgent` — the pure half of slice 5d-i (the deferred 1c-ii).
 *
 * The certificate contents are never real: every "cert" here is a short marker
 * buffer, because nothing under test parses one. What is under test is which
 * markers reach the agent's `ca`, that `https.globalAgent` is never touched, and
 * that an unreadable path is reported rather than swallowed.
 */
describe("buildCaAgent", () => {
  /** The one assertion this slice exists to protect: upstream's `CAHelper.ts`
   * mutates `https.globalAgent.options.ca`, and this must not. Checked around
   * every test, not just once, so a regression in any path is caught. */
  const assertGlobalAgentUntouched = (): void => {
    assert.equal(
      globalAgent.options.ca,
      undefined,
      "buildCaAgent must never write to https.globalAgent",
    );
  };

  beforeEach(assertGlobalAgentUntouched);
  afterEach(assertGlobalAgentUntouched);

  it("returns no agent and reads nothing when the list is empty", () => {
    let reads = 0;
    const result = buildCaAgent([], (path) => {
      reads += 1;
      return Buffer.from(path);
    });

    assert.equal(result.agent, undefined);
    assert.deepEqual(result.failures, []);
    assert.equal(reads, 0);
  });

  it("builds a dedicated agent trusting the bundled roots plus the user's cert", () => {
    const cert = Buffer.from("-----BEGIN CERTIFICATE----- one");
    const result = buildCaAgent(["/etc/viya/ca.pem"], () => cert);

    assert.ok(result.agent instanceof Agent);
    assert.notEqual(
      result.agent,
      globalAgent,
      "the agent must be a fresh instance, not https.globalAgent",
    );
    const ca = result.agent.options.ca;
    assert.ok(Array.isArray(ca));
    // Node's `ca` option replaces the default trust store, so the bundled roots
    // have to be carried across or ordinary TLS stops verifying.
    assert.equal(ca.length, rootCertificates.length + 1);
    assert.equal(ca[ca.length - 1], cert);
    for (const root of rootCertificates) assert.ok(ca.includes(root));
    assert.deepEqual(result.failures, []);
  });

  it("skips blank and whitespace-only entries without reporting them", () => {
    const read = (): Buffer => Buffer.from("cert");
    const result = buildCaAgent(["", "   ", "\t"], read);

    assert.equal(result.agent, undefined);
    assert.deepEqual(result.failures, []);
  });

  it("trims paths and reads a repeated one only once", () => {
    const paths: string[] = [];
    const result = buildCaAgent([" /ca.pem ", "/ca.pem", "/ca.pem"], (path) => {
      paths.push(path);
      return Buffer.from(path);
    });

    assert.deepEqual(paths, ["/ca.pem"]);
    assert.ok(result.agent instanceof Agent);
    assert.equal(result.agent.options.ca?.length, rootCertificates.length + 1);
  });

  it("records an unreadable path and still trusts the ones that read", () => {
    const good = Buffer.from("good cert");
    const result = buildCaAgent(["/missing.pem", "/good.pem"], (path) => {
      if (path === "/missing.pem") {
        throw new Error(
          "ENOENT: no such file or directory, open '/missing.pem'",
        );
      }
      return good;
    });

    assert.deepEqual(result.failures, [
      {
        path: "/missing.pem",
        reason: "ENOENT: no such file or directory, open '/missing.pem'",
      },
    ]);
    assert.ok(result.agent instanceof Agent);
    const ca = result.agent.options.ca;
    assert.ok(Array.isArray(ca));
    assert.equal(ca[ca.length - 1], good);
    assert.equal(ca.length, rootCertificates.length + 1);
  });

  it("returns no agent when every configured path fails", () => {
    const result = buildCaAgent(["/a.pem", "/b.pem"], (path) => {
      throw new Error(`cannot read ${path}`);
    });

    assert.equal(result.agent, undefined);
    assert.deepEqual(result.failures, [
      { path: "/a.pem", reason: "cannot read /a.pem" },
      { path: "/b.pem", reason: "cannot read /b.pem" },
    ]);
  });

  it("stringifies a non-Error throw rather than letting it surface raw", () => {
    const result = buildCaAgent(["/x.pem"], () => {
      throw "permission denied";
    });

    assert.deepEqual(result.failures, [
      { path: "/x.pem", reason: "permission denied" },
    ]);
    assert.equal(result.agent, undefined);
  });
});
