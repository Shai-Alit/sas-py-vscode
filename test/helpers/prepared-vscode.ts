// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import { statSync } from "node:fs";
import * as path from "node:path";

/**
 * Lets the integration tier reuse a VS Code that is already on disk instead of
 * downloading one.
 *
 * `@vscode/test-electron` caches its download in `.vscode-test/`, keyed by
 * version *and platform*, and there is no supported way to move that cache. So
 * a checkout shared between two platforms — a Windows working tree opened from
 * a Linux container, a CI runner with a warm cache mounted read-only, a
 * developer on a metered connection — pays the full 330 MB again for the second
 * platform, on every clean run.
 *
 * `PYTHON_ON_VIYA_TEST_VSCODE` points at an editor that is already there.
 * Nothing changes when it is unset, which is the case in CI today and on a
 * normal `npm run test:integration`.
 *
 * Two things this deliberately does *not* do. It does not fall back to
 * downloading when the path is wrong: a typo would then cost the download the
 * variable exists to avoid, and would do it silently, which is the same defect
 * wearing a different hat. And it does not set `reuseMachineInstall`, so the
 * launched editor still gets the throwaway `--user-data-dir` and
 * `--extensions-dir` that `runTests` derives — pointing this at an editor you
 * use daily cannot touch your real settings or your installed extensions.
 */

/** The environment variable, named once so the tests and the docs cannot drift. */
export const PREPARED_VSCODE_ENV = "PYTHON_ON_VIYA_TEST_VSCODE";

/**
 * The executable inside an extracted VS Code directory, per platform.
 *
 * These mirror `downloadDirToExecutablePath` in `@vscode/test-electron`, which
 * is not exported. Mirroring three constants is the lesser evil against
 * reaching into `out/` of a dependency, and if they ever diverge the failure is
 * a clear "no executable there" rather than a mystery.
 */
function executableWithin(
  directory: string,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32") return path.join(directory, "Code.exe");
  if (platform === "darwin") {
    return path.join(
      directory,
      "Visual Studio Code.app",
      "Contents",
      "MacOS",
      "Electron",
    );
  }
  return path.join(directory, "code");
}

/** `"file"`, `"directory"`, or `"missing"` — never throws. */
function kindOf(target: string): "file" | "directory" | "missing" {
  try {
    return statSync(target).isDirectory() ? "directory" : "file";
  } catch {
    return "missing";
  }
}

/**
 * Resolves `PYTHON_ON_VIYA_TEST_VSCODE` to an executable path.
 *
 * Accepts either the executable itself or the directory an archive was
 * extracted into, because the useful thing to have lying around is the
 * directory and remembering which file inside it is the binary is exactly the
 * sort of detail a helper should absorb.
 *
 * @returns the executable, or `undefined` when the variable is unset — which
 *   means "download as usual".
 * @throws if the variable is set and does not lead to something that exists.
 */
export function resolvePreparedVSCode(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  const raw = env[PREPARED_VSCODE_ENV]?.trim();
  if (raw === undefined || raw === "") return undefined;

  const target = path.resolve(raw);
  const kind = kindOf(target);

  if (kind === "file") return target;

  if (kind === "missing") {
    throw new Error(
      `${PREPARED_VSCODE_ENV} is set to ${raw}, which does not exist (resolved to ${target}). ` +
        `Unset it to download VS Code as usual, or point it at an extracted VS Code directory or its executable.`,
    );
  }

  const executable = executableWithin(target, platform);
  if (kindOf(executable) !== "file") {
    throw new Error(
      `${PREPARED_VSCODE_ENV} is set to the directory ${target}, but there is no VS Code executable at ${executable}. ` +
        `Point it at the directory an archive was extracted into, or at the executable itself.`,
    );
  }

  return executable;
}
