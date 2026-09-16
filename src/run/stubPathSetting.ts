// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Decides whether it is safe to point `python.analysis.stubPath` at this
 * feature's own generated stub tree — 10b (`docs/phases/phase-10.md`'s
 * Runbook, the workspace-settings item).
 *
 * **This module must never import `vscode`.** Pure over the setting's
 * current inspected values — `pylanceStubSync.ts` is the one caller that
 * reads them via `vscode.workspace.getConfiguration(...).inspect(...)` and
 * calls `.update(...)` to act on the decision.
 *
 * ## Why this is a decision, not just a write
 *
 * `stubPath` is a single value, not a merged list — Pylance reads exactly
 * one directory. If a user (or another extension) already pointed it
 * somewhere else, on purpose — at *any* scope, not only this workspace —
 * overwriting it would silently break whatever stubs they already depend on
 * there. So this only ever writes when the setting is genuinely unset at
 * every scope that could apply here, or already equal to this feature's own
 * path (a repeat sync, safe to no-op) — never when some scope already holds
 * something else. An earlier version of this function checked only
 * `workspaceValue`, which missed a value set at *user* scope: writing a
 * workspace-scoped override in that case would still leave the user's own
 * global setting file untouched, but the *effective* `stubPath` inside this
 * workspace would silently become this feature's own path the moment it
 * ran, exactly the silent breakage this function exists to prevent (Codex
 * review finding on PR #182).
 *
 * `WorkspaceConfiguration.inspect(...)`'s separate `globalValue` /
 * `workspaceValue` / `workspaceFolderValue` fields are what distinguish
 * "genuinely unset at that scope" from "resolved to Pylance's own default"
 * — inspecting the *effective*, already-merged value (`.get(...)`) would
 * conflate the two and refuse to ever write anything, since a value the
 * default already supplies would look identical to one a user chose. Using
 * `inspect(...)`'s per-scope fields directly, for every scope that can
 * affect this workspace, avoids that conflation while still catching a
 * value set outside workspace scope.
 */

export type StubPathDecision =
  | { readonly kind: "write" }
  | { readonly kind: "already-ours" }
  | { readonly kind: "conflict"; readonly currentValue: string };

/** The `inspect("stubPath")` fields that can affect what `stubPath`
 * resolves to inside a given workspace folder — every scope below
 * `defaultValue` and above language-specific overrides (this setting has
 * none), in VS Code's own precedence order (`workspaceFolderValue` >
 * `workspaceValue` > `globalValue`). `defaultValue` is deliberately excluded
 * — see this module's own doc comment for why conflating it with a
 * genuinely-set value would break the "never write when already set"
 * guarantee. */
export interface InspectedStubPathValues {
  readonly globalValue: string | undefined;
  readonly workspaceValue: string | undefined;
  readonly workspaceFolderValue: string | undefined;
}

/**
 * `current` is the relevant subset of `WorkspaceConfiguration.inspect
 * ("stubPath")` — every field `undefined` means nothing has set it at any
 * scope this workspace resolves through. `ourValue` is the path this
 * feature would write.
 */
export function decideStubPathAction(
  current: InspectedStubPathValues,
  ourValue: string,
): StubPathDecision {
  const existing =
    current.workspaceFolderValue ??
    current.workspaceValue ??
    current.globalValue;
  if (existing === undefined) return { kind: "write" };
  if (existing === ourValue) return { kind: "already-ours" };
  return { kind: "conflict", currentValue: existing };
}
