// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The decisions `commands.ts`'s `syncStubsForFreshProbe` makes around a 10b
 * stub sync — which packages to hand `pylanceStubSync.ts`, and what a
 * completed sync means for the caller (worth a "reload the window" notice?
 * worth a log line? worth telling the user something?) — pulled out into
 * their own pure module so they are unit-testable on their own.
 *
 * **This module must never import `vscode`.** `commands.ts` imports `vscode`
 * and is excluded from the unit coverage tier entirely (same
 * `check-coverage-scope.mjs` discipline `localPythonEnvironment.ts` and
 * `pylanceStubSync.ts` already follow), so a decision that only ever lived
 * inline there — which packages `diff.kind === "local-unknown"` stubs, or
 * which of the four non-`"synced"` `PylanceStubSyncResult` kinds gets a log
 * line versus a user-facing notice — had no tier that could exercise it
 * without a live Viya probe. Restating the shapes this module needs (see
 * {@link StubSyncOutcome}) rather than importing `PylanceStubSyncResult`
 * from `./pylanceStubSync` keeps that module's own `vscode` import from
 * infecting this one — the same restatement discipline `stubGenerator.ts`
 * and `environmentDiff.ts` already follow for the types they borrow from
 * `vscode`-adjacent or otherwise-heavier modules.
 */

import type { EnvironmentDiff } from "./environmentDiff";
import type { StubbablePackage } from "./stubGenerator";

/** What a stub sync should actually stub, plus any `remoteOnly` entry that
 * could not be resolved. */
export interface StubSelection {
  readonly toStub: readonly StubbablePackage[];
  /**
   * Names `diff.remoteOnly` reported that were not found by exact name in
   * `remote` — `diffEnvironments` derives every `remoteOnly` entry's name
   * from that same `remote` list, so a miss here should never happen. Not
   * asserted against, since a defensive filter degrading to "skip it" is
   * safer than a thrown error over a diff mismatch this module cannot itself
   * diagnose — but a caller should not let it pass in silence either, hence
   * it is returned rather than swallowed.
   */
  readonly missing: readonly string[];
}

/**
 * Chooses which packages a stub sync should generate stubs for — 10b's
 * Finding 10.2 rule: only `diff.remoteOnly`, or every remote package when the
 * local environment itself is unknown and there is nothing local to shadow.
 * See `stubGenerator.ts`'s own doc comment, "Why only the caller's given
 * list", for the full reasoning this enforces.
 */
export function selectPackagesToStub(
  remote: readonly StubbablePackage[],
  diff: EnvironmentDiff,
): StubSelection {
  if (diff.kind === "local-unknown") return { toStub: remote, missing: [] };

  const byName = new Map(remote.map((pkg) => [pkg.name, pkg]));
  const toStub: StubbablePackage[] = [];
  const missing: string[] = [];
  for (const entry of diff.remoteOnly) {
    const pkg = byName.get(entry.name);
    if (pkg === undefined) missing.push(entry.name);
    else toStub.push(pkg);
  }
  return { toStub, missing };
}

/**
 * A restated mirror of `pylanceStubSync.ts`'s own `PylanceStubSyncResult` —
 * see this module's own doc comment for why it is restated rather than
 * imported. Kept in sync with that type by hand; `commands.ts` assigns a real
 * `PylanceStubSyncResult` into this type at its one call site, so the two
 * drifting apart is a compile error there, not a silent mismatch.
 */
export type StubSyncOutcome =
  | { readonly kind: "synced"; readonly changed: boolean }
  | { readonly kind: "nothing-to-stub" }
  | { readonly kind: "no-workspace" }
  | { readonly kind: "unsupported-workspace"; readonly scheme: string }
  | { readonly kind: "stub-path-conflict"; readonly currentValue: string }
  | { readonly kind: "write-failed"; readonly detail: string };

/** What `commands.ts` should do in response to a completed stub sync. */
export interface StubSyncReport {
  /** Worth telling the user a window reload would reflect the change —
   * `showEnvironmentImpl`/`searchEnvironmentImpl` both show the same
   * l10n-formatted notice when this is `true`. `true` only for `"synced"`
   * with `changed: true`: a fresh probe that resynced to the exact same
   * stub tree already on disk has nothing new for a reload to reveal, so it
   * must not repeat the notice on every "Refresh Environment Info". */
  readonly reloadAdvisable: boolean;
  /** A plain-text line for the `Python on Viya` log, or `undefined` for an
   * outcome that needs no log line at all (`"synced"`, `"nothing-to-stub"`).
   * Not run through `vscode.l10n.t` — this codebase's own log lines never
   * are (e.g. `commands.ts`'s existing `log.warn(probed.reason)`), only
   * user-facing `inform`/`report` text is. */
  readonly logWarning: string | undefined;
  /**
   * Set only for `"stub-path-conflict"` — the value to interpolate into the
   * localized "already set to X" notice. Handed back as data, never as a
   * formatted string, because `vscode.l10n.t` must be called from
   * `commands.ts` itself (this module must never import `vscode`).
   */
  readonly conflictValue: string | undefined;
}

export function describeStubSyncOutcome(
  outcome: StubSyncOutcome,
): StubSyncReport {
  switch (outcome.kind) {
    case "synced":
      return {
        reloadAdvisable: outcome.changed,
        logWarning: undefined,
        conflictValue: undefined,
      };
    case "nothing-to-stub":
      return {
        reloadAdvisable: false,
        logWarning: undefined,
        conflictValue: undefined,
      };
    case "no-workspace":
      return {
        reloadAdvisable: false,
        logWarning:
          "Pylance stub sync (10b): no workspace folder is open, so there is nowhere to write generated stubs.",
        conflictValue: undefined,
      };
    case "unsupported-workspace":
      return {
        reloadAdvisable: false,
        logWarning: `Pylance stub sync (10b): the open workspace folder is not on the local filesystem (scheme "${outcome.scheme}"), so there is nowhere to write generated stubs.`,
        conflictValue: undefined,
      };
    case "stub-path-conflict":
      return {
        reloadAdvisable: false,
        logWarning: `Pylance stub sync (10b): python.analysis.stubPath is already set to "${outcome.currentValue}" in this workspace, so Python on Viya left it untouched.`,
        conflictValue: outcome.currentValue,
      };
    case "write-failed":
      return {
        reloadAdvisable: false,
        logWarning: `Pylance stub sync (10b): writing the generated stub tree or the python.analysis.stubPath setting failed: ${outcome.detail}`,
        conflictValue: undefined,
      };
  }
}
