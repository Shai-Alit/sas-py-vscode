// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  PREPARED_VSCODE_ENV,
  resolvePreparedVSCode,
} from "../helpers/prepared-vscode";

/**
 * This runs against a real directory in the OS temp area rather than a mocked
 * `fs`. The whole job of the function is to decide what is on disk, so a fake
 * disk would be testing the fake — and the cost is a `mkdtemp` and an `rm`,
 * outside the repository, well inside the unit tier's two-second budget.
 *
 * Platform is a parameter rather than a global, which is the only reason the
 * Windows and macOS layouts can be asserted from Linux CI at all.
 */
describe("resolvePreparedVSCode", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "prepared-vscode-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Creates an empty file, making its parent directories as needed. */
  function touch(...segments: string[]): string {
    const target = path.join(root, ...segments);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "");
    return target;
  }

  it("returns nothing when the variable is unset, so the download still happens", () => {
    assert.equal(resolvePreparedVSCode({}, "linux"), undefined);
  });

  it("treats an empty or whitespace value as unset", () => {
    // `VAR=` in a shell profile, or a CI expression that evaluated to nothing.
    // Neither means "use the editor at the empty path".
    assert.equal(
      resolvePreparedVSCode({ [PREPARED_VSCODE_ENV]: "" }, "linux"),
      undefined,
    );
    assert.equal(
      resolvePreparedVSCode({ [PREPARED_VSCODE_ENV]: "   " }, "linux"),
      undefined,
    );
  });

  it("accepts the executable itself", () => {
    const executable = touch("code");
    assert.equal(
      resolvePreparedVSCode({ [PREPARED_VSCODE_ENV]: executable }, "linux"),
      executable,
    );
  });

  it("accepts an extracted directory and finds the executable inside it", () => {
    // The useful thing to have staged is the directory an archive was unpacked
    // into; which file inside it is the binary is the helper's problem.
    const executable = touch("vscode-linux-x64-1.133.0", "code");
    assert.equal(
      resolvePreparedVSCode(
        { [PREPARED_VSCODE_ENV]: path.dirname(executable) },
        "linux",
      ),
      executable,
    );
  });

  it("knows where the executable lives on each platform", () => {
    const windows = touch("win", "Code.exe");
    const macos = touch(
      "mac",
      "Visual Studio Code.app",
      "Contents",
      "MacOS",
      "Electron",
    );

    assert.equal(
      resolvePreparedVSCode(
        { [PREPARED_VSCODE_ENV]: path.join(root, "win") },
        "win32",
      ),
      windows,
    );
    assert.equal(
      resolvePreparedVSCode(
        { [PREPARED_VSCODE_ENV]: path.join(root, "mac") },
        "darwin",
      ),
      macos,
    );
  });

  it("refuses a path that does not exist instead of downloading anyway", () => {
    // The failure this variable exists to prevent is a 330 MB download. Falling
    // back on a typo would perform exactly that download, silently, which is
    // the same defect with better manners.
    assert.throws(
      () =>
        resolvePreparedVSCode(
          { [PREPARED_VSCODE_ENV]: path.join(root, "nowhere") },
          "linux",
        ),
      (error: Error) => {
        assert.match(error.message, new RegExp(PREPARED_VSCODE_ENV));
        assert.match(error.message, /does not exist/);
        return true;
      },
    );
  });

  it("says what it looked for when the directory holds no executable", () => {
    // Most likely cause: an archive extracted without stripping its top-level
    // folder, so the binary is one level deeper than expected. The message has
    // to name the path it checked or that is unguessable.
    mkdirSync(path.join(root, "empty"));
    assert.throws(
      () =>
        resolvePreparedVSCode(
          { [PREPARED_VSCODE_ENV]: path.join(root, "empty") },
          "linux",
        ),
      (error: Error) => {
        assert.match(error.message, /no VS Code executable at/);
        assert.match(error.message, /empty/);
        return true;
      },
    );
  });

  it("resolves a relative path rather than handing one on", () => {
    // `runTests` spawns the executable; a path relative to whatever the cwd was
    // at spawn time is a bug that only shows up when someone runs the suite
    // from a subdirectory.
    const executable = touch("code");
    const relative = path.relative(process.cwd(), executable);
    assert.equal(
      resolvePreparedVSCode({ [PREPARED_VSCODE_ENV]: relative }, "linux"),
      executable,
    );
  });
});
