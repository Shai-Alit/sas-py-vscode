// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { resolvesFromBundledTypeshed } from "../../src/run/typeshedNames";

/**
 * The third of 10b's three shadowing guards — see `typeshedNames.ts`'s own doc
 * comment, and Finding 10.7 (`docs/phases/phase-10.md`'s Probe findings) for
 * the pyright runs that measured what each half costs when it is missing.
 *
 * These cases pin the *contract* (which kinds of name are covered, and that
 * the comparison folds case), not the list's exact contents: the list is
 * generated from a pinned pyright release and is expected to move by a few
 * entries per typeshed update, so asserting its length or membership wholesale
 * would be a test of the generator rather than of this module.
 */
describe("typeshedNames.ts — names Pylance already resolves from its own bundled typeshed", () => {
  describe("resolvesFromBundledTypeshed", () => {
    it("covers a stdlib module a backport distribution can be named after", () => {
      // The exact name Finding 10.7 shadowed: a generated `typing` stub took
      // 1 real type error down to 0, silently.
      assert.equal(resolvesFromBundledTypeshed("typing"), true);
      assert.equal(resolvesFromBundledTypeshed("dataclasses"), true);
      assert.equal(resolvesFromBundledTypeshed("contextvars"), true);
    });

    it("covers a private/underscore stdlib name too", () => {
      // A distribution is free to ship one, and shadowing `_thread` is no
      // less silent than shadowing `typing`.
      assert.equal(resolvesFromBundledTypeshed("_thread"), true);
    });

    it("covers a bundled third-party stub's top-level name", () => {
      // `simplejson` is the one Finding 10.7 measured directly: with a
      // generated stub in place, the `reportMissingModuleSource` warning was
      // unchanged and a real `reportAssignmentType` error disappeared.
      assert.equal(resolvesFromBundledTypeshed("simplejson"), true);
      assert.equal(resolvesFromBundledTypeshed("yaml"), true);
      assert.equal(resolvesFromBundledTypeshed("six"), true);
    });

    it("leaves a name typeshed ships no stubs for alone", () => {
      // The packages this feature actually exists to stub — no typeshed
      // coverage, so a catch-all stub is a strict improvement over
      // `reportMissingImports` for them.
      assert.equal(resolvesFromBundledTypeshed("numpy"), false);
      assert.equal(resolvesFromBundledTypeshed("pandas"), false);
      assert.equal(resolvesFromBundledTypeshed("scipy"), false);
      assert.equal(resolvesFromBundledTypeshed("swat"), false);
    });

    it("compares case-insensitively, the way Windows and macOS filesystems resolve", () => {
      // A generated `Typing/` directory resolves for `import typing` on both
      // of those, so a case-sensitive check here would let the shadow through
      // on the two platforms most of this extension's users are on.
      assert.equal(resolvesFromBundledTypeshed("Typing"), true);
      assert.equal(resolvesFromBundledTypeshed("SIX"), true);
      // …and in the other direction, for a name typeshed itself spells with
      // capitals.
      assert.equal(resolvesFromBundledTypeshed("mysqldb"), true);
    });

    it("says no to an empty name rather than throwing", () => {
      // `generateStubTree`'s identifier guard already rejects this before it
      // gets here, but nothing in this module's own signature rules it out.
      assert.equal(resolvesFromBundledTypeshed(""), false);
    });
  });
});
