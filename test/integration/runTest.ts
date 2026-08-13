// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0
//
// Structure follows: client/test/runTest.ts in sassoftware/vscode-sas-extension
// (Apache-2.0). No code was copied — the two-halves shape of the integration
// tier is dictated by @vscode/test-electron, and this file was written against
// its API, with the launch arguments corrected and the error path changed to
// preserve the exit code without truncating output.
//
// No SAS copyright line is added here, and none was dropped: the upstream file
// carries no copyright header at all. Adding one would misattribute authorship.
// See CONTRIBUTING.md, "Declare any relationship to upstream code".

import * as path from "node:path";

import { runTests } from "@vscode/test-electron";

import {
  PREPARED_VSCODE_ENV,
  resolvePreparedVSCode,
} from "../helpers/prepared-vscode";

/**
 * Downloads a real VS Code, launches it with this extension loaded from source,
 * and runs `index.js` inside it.
 *
 * This is the outer half of the integration tier: it runs in a plain Node
 * process. The inner half (`index.ts`) runs inside the extension host, where
 * `require("vscode")` resolves.
 */
async function main(): Promise<void> {
  // out/test/integration → out/test → out → the repository root, which is what
  // holds package.json and therefore what VS Code treats as the extension.
  const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
  const extensionTestsPath = path.resolve(__dirname, "./index");

  // Unset in CI and in a normal run, where the download and its cache are
  // exactly what is wanted. Announced when it is set, because "these tests ran
  // against some other build of the editor" is the first thing you want to know
  // when a result here disagrees with a result somewhere else.
  const preparedVSCode = resolvePreparedVSCode(process.env, process.platform);
  if (preparedVSCode !== undefined) {
    console.log(`${PREPARED_VSCODE_ENV} is set — using ${preparedVSCode}`);
  }

  await runTests({
    ...(preparedVSCode === undefined
      ? {}
      : { vscodeExecutablePath: preparedVSCode }),
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      // Nothing else installed: another extension's activation cost, keybinding,
      // or error dialog is not something these tests should be measuring.
      "--disable-extensions",

      // Two array entries, not the single "--locale en-US" string upstream
      // passes. Electron receives argv verbatim, so the joined form arrives as
      // one unrecognised flag and is dropped — the locale silently stays
      // whatever the host machine has, which is precisely the variable this
      // argument exists to remove. Ported code gets audited, not transcribed.
      "--locale",
      "en-US",
    ],
  });
}

main().catch((error: unknown) => {
  console.error("Integration test run failed.");
  console.error(error);

  // Not process.exit(1): that can truncate the output above on some platforms,
  // and the output is the only reason anyone is reading this line.
  process.exitCode = 1;
});
