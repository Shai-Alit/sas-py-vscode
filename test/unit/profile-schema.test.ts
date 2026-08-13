// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { normaliseEndpoint } from "../../src/profile/model";
import { endpointSchemaPattern } from "../helpers/manifest";

/**
 * There are two things in this repository that judge an endpoint: the JSON
 * schema in `package.json`, which the settings editor applies as you type, and
 * `normaliseEndpoint`, which is the authority and re-runs on every read.
 *
 * They are deliberately not the same. The schema is a *hint* — it catches the
 * one mistake worth catching before you have finished typing (a credential in
 * the URL) and stays quiet about everything else, because a settings editor
 * that underlines a half-typed address is an editor people turn off. The real
 * rules are richer: https except on loopback, no query, no fragment.
 *
 * The failure mode this file exists to prevent is someone reading the loose
 * pattern as an oversight and tightening it to match. That would create a
 * second validator with its own opinion, in a file the tests do not run, and
 * the first symptom would be a red squiggle under an endpoint that works
 * perfectly. So the relationship is asserted rather than described in a comment
 * — and it has to be asserted here, because `package.json` is JSON and cannot
 * hold the comment that would otherwise have said this.
 */
describe("the endpoint schema and the endpoint validator", () => {
  /**
   * Endpoints a user might reasonably put in `settings.json`. Each is asserted
   * to be accepted by the real validator before it is used to judge the schema,
   * so the corpus cannot quietly rot into a list of strings that prove nothing.
   */
  const accepted = [
    "https://viya.example.com",
    "https://viya.example.com/",
    "viya.example.com",
    "https://viya.example.com:8443",
    "https://viya.example.com/gateway",
    "https://viya-4.example.co.uk",
    "http://localhost:8080",
    "http://127.0.0.1",
    "  https://viya.example.com  ",
  ];

  it("agrees that every endpoint the validator accepts is accepted", () => {
    const pattern = endpointSchemaPattern();

    for (const raw of accepted) {
      const result = normaliseEndpoint(raw);
      assert.ok(
        result.ok,
        `the corpus is stale: normaliseEndpoint now rejects ${JSON.stringify(raw)}` +
          (result.ok ? "" : ` — ${result.reason}`),
      );

      // Both forms matter. A hand-edited settings file holds whatever was
      // typed; a profile written by the extension holds the normalised value.
      // The settings editor applies the pattern to both.
      assert.ok(
        pattern.test(raw),
        `the schema pattern ${String(pattern)} rejects ${JSON.stringify(raw)}, ` +
          `which normaliseEndpoint accepts — the settings editor would flag a working endpoint`,
      );
      assert.ok(
        pattern.test(result.value),
        `the schema pattern ${String(pattern)} rejects the normalised form ${JSON.stringify(result.value)}`,
      );
    }
  });

  it("is deliberately looser than the validator, and stays that way", () => {
    // If this ever fails, the schema has been tightened into a second source of
    // truth. That is the change this file is here to make someone justify.
    const pattern = endpointSchemaPattern();
    const looserBy = [
      "ftp://viya.example.com", // wrong scheme
      "http://viya.example.com", // cleartext, not loopback
      "https://viya.example.com?tab=1", // query string
      "https://viya.example.com#top", // fragment
    ];

    for (const raw of looserBy) {
      assert.ok(
        pattern.test(raw),
        `the schema pattern now rejects ${JSON.stringify(raw)}. If that was intentional, ` +
          `move the rule into normaliseEndpoint instead — the schema is a hint, not a validator.`,
      );
      assert.equal(
        normaliseEndpoint(raw).ok,
        false,
        `the corpus is stale: normaliseEndpoint now accepts ${JSON.stringify(raw)}`,
      );
    }
  });

  it("catches the one thing it is meant to catch", () => {
    // The pattern's entire job. Kept as an assertion so that deleting the
    // pattern altogether fails here rather than passing the two tests above,
    // both of which an absent rule would satisfy.
    const pattern = endpointSchemaPattern();
    // Assembled at run time so that this file contains no string that the
    // repository's own check:secrets would have to be told to ignore.
    const withCredential = ["https://user", "secret@viya.example.com"].join(
      ":",
    );

    assert.equal(pattern.test(withCredential), false);
    assert.equal(normaliseEndpoint(withCredential).ok, false);
  });
});
