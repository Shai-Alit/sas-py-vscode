// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { declaredNodeEngine } from "../helpers/manifest";

/**
 * What the extension host's JavaScript runtime actually provides.
 *
 * ## Why this suite exists
 *
 * Review of the 2a-i pull request raised, as a **blocking** finding, that
 * `AbortSignal.any` "is not available in the VS Code extension host runtime
 * (Node 18 / Electron 25)" and that every Compute request would therefore throw
 * a `TypeError` before reaching the wire. The claim was wrong on both legs, and
 * the evidence is worth writing down once:
 *
 * - Node added `AbortSignal.any(signals)` in **v20.3.0 and v18.17.0**
 *   (nodejs.org/api/globals.html), so even a Node 18 host of any recent patch
 *   level has it.
 * - `package.json` declares `engines.vscode ^1.104.0`. microsoft/vscode at tag
 *   `1.104.0` builds against Electron **37.3.1** (`.npmrc`), and Electron
 *   `v37.3.1` pins Node **v22.18.0** (`DEPS`). Electron 25 was VS Code 1.80,
 *   years below our declared floor.
 *
 * ## Why it is a test rather than a comment
 *
 * A version claim in a comment is unfalsifiable and ages badly; the next
 * reviewer, human or otherwise, has no reason to trust it over their own
 * recollection. This suite runs inside the real extension host on all three
 * operating systems in CI, so the answer comes from the runtime that will
 * actually execute the code. If we ever lower `engines.vscode` far enough to
 * matter, this fails immediately and names the reason — which is the failure a
 * user would otherwise meet as "the very first request threw".
 *
 * Keep this suite about *runtime capabilities the code relies on*, not about
 * version numbers for their own sake. A capability we do not use does not
 * belong here.
 */
describe("extension host runtime", () => {
  it("provides AbortSignal.any, which the Compute client composes signals with", () => {
    assert.equal(
      typeof AbortSignal.any,
      "function",
      `AbortSignal.any is missing from this extension host (Node ${process.versions.node}). ` +
        "src/compute/client.ts combines the caller's cancellation signal with its own timeout through it, " +
        "so every Compute request would throw before the request was sent. Node has had it since v20.3.0 and v18.17.0.",
    );
  });

  it("provides AbortSignal.timeout, which every request in the extension uses", () => {
    // Older than `any` (v17.3.0/v16.14.0) and used by the auth modules as well
    // as by Compute, so it fails first and should say so for itself.
    assert.equal(
      typeof AbortSignal.timeout,
      "function",
      `AbortSignal.timeout is missing from this extension host (Node ${process.versions.node}).`,
    );
  });

  it("composes two signals into one that either can abort", () => {
    // Presence is not behaviour. This is the property client.ts depends on:
    // whichever signal fires first is the one that cancels the request, and the
    // reason survives so a caller can tell a user cancellation from a timeout.
    const caller = new AbortController();
    const timeout = new AbortController();
    const combined = AbortSignal.any([caller.signal, timeout.signal]);

    assert.equal(combined.aborted, false);
    caller.abort(new Error("the user cancelled"));

    assert.equal(combined.aborted, true);
    assert.ok(
      combined.reason instanceof Error,
      "the abort reason did not survive composition",
    );
    assert.equal(combined.reason.message, "the user cancelled");
  });

  it("runs on a Node at or above the version the manifest declares", () => {
    // The manifest's `engines.node` is the claim about which runtime everything
    // in `src/` may assume. Read it rather than repeating it here, so the two
    // cannot drift apart while both keep reporting success.
    const declared = declaredNodeEngine();
    const floor = /(\d+)\.(\d+)/.exec(declared);
    assert.ok(
      floor,
      `package.json declares engines.node as "${declared}", which has no major.minor to compare a runtime against.`,
    );

    const [, floorMajor = "0", floorMinor = "0"] = floor;
    const [major = "0", minor = "0"] = process.versions.node.split(".");
    const atLeastFloor =
      Number(major) > Number(floorMajor) ||
      (Number(major) === Number(floorMajor) &&
        Number(minor) >= Number(floorMinor));

    assert.ok(
      atLeastFloor,
      `the extension host runs Node ${process.versions.node}, below the "${declared}" floor package.json declares. ` +
        "Either the manifest is wrong about which hosts we support, or src/ is using APIs this host does not have.",
    );
  });
});
