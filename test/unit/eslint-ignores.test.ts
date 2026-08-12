// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import path from "node:path";

import { ESLint } from "eslint";

/**
 * What ESLint refuses to look at.
 *
 * Flat config does not read `.gitignore`. Everything ESLint should skip has to
 * be listed a second time in `eslint.config.mjs`, and the two files drifting
 * apart produces a failure that looks nothing like its cause: `npm run lint`
 * dies with "FATAL ERROR: Reached heap limit" on a tree whose source has not
 * changed. That happened here — `npm run test:integration` downloads roughly a
 * gigabyte of VS Code into `.vscode-test/`, including minified bundles large
 * enough to exhaust the V8 heap on their own, so running the integration tier
 * once broke linting from then on.
 *
 * The check runs through ESLint's own resolver rather than reading the
 * `ignores` array, because the array is not the thing that matters — a pattern
 * that is present but does not match (`.vscode-test` without the `/**`, say)
 * would satisfy a shape assertion and still let the whole directory through.
 */
describe("eslint ignore coverage", () => {
  // The only unit test that is allowed to be slow, and it is not doing I/O of
  // its own: constructing ESLint loads the flat config, which pulls in the
  // whole typescript-eslint module graph. That is seconds on a warm local disk
  // and considerably worse over a network mount. Rather than raise the 2s
  // budget for the tier — where a slow test really does mean a stuck one —
  // the exemption is spelled out here, once, for the one test that earns it.
  const LOAD_BUDGET_MS = 60_000;

  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  let eslint: ESLint;

  before(function () {
    this.timeout(LOAD_BUDGET_MS);
    eslint = new ESLint({ cwd: repoRoot });
  });

  // Generated or downloaded, never authored here. `.vscode-test/` is the one
  // with teeth; the rest are listed so that a future reshuffle of the ignores
  // array cannot quietly drop one.
  const ignored = [
    ".vscode-test/out/vscode-win32-x64-archive/resources/app/out/vs/code.js",
    ".vscode-test-web/some/bundle.js",
    "node_modules/left-pad/index.js",
    "out/src/extension.js",
    "dist/extension.js",
    "coverage/lcov-report/block-navigation.js",
    "test/scratch/throwaway.ts",
    "site/assets/app.BSbNVzT7.js",
    "docs/.vitepress/cache/deps/vitepress.js",
  ];

  // Named by the full path rather than the first segment. `docs/` is not
  // ignored — only `docs/.vitepress/cache/` is — and a test reading "ignores
  // docs" would describe a configuration that would be a bug.
  for (const file of ignored) {
    it(`ignores ${file}`, async function () {
      this.timeout(LOAD_BUDGET_MS);
      assert.equal(
        await eslint.isPathIgnored(file),
        true,
        `${file} is linted. If it is a build artefact, add it to the ignores block in eslint.config.mjs — .gitignore has no effect on ESLint.`,
      );
    });
  }

  // Negative control. Without it, `ignores: ["**"]` passes every assertion
  // above while linting nothing at all.
  it("still lints the extension source and its own config", async function () {
    this.timeout(LOAD_BUDGET_MS);
    for (const file of [
      "src/extension.ts",
      "eslint.config.mjs",
      // Ignoring the cache must not take the config with it. This is the one
      // file under docs/ that is code, and an unlinted config quietly rots.
      "docs/.vitepress/config.mjs",
    ]) {
      assert.equal(
        await eslint.isPathIgnored(file),
        false,
        `${file} is being skipped by ESLint, so nothing in it is checked.`,
      );
    }
  });
});
