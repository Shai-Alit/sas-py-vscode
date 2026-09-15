// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Decides whether it is safe to point `python.analysis.stubPath` at this
 * feature's own generated stub tree — 10b (`docs/phases/phase-10.md`'s
 * Runbook, the workspace-settings item).
 *
 * **This module must never import `vscode`.** Pure over the setting's
 * current workspace-scoped value — `pylanceStubSync.ts` is the one caller
 * that reads it via `vscode.workspace.getConfiguration(...).inspect(...)`
 * and calls `.update(...)` to act on the decision.
 *
 * ## Why this is a decision, not just a write
 *
 * `stubPath` is a single value, not a merged list — Pylance reads exactly
 * one directory. If a user (or another extension) already pointed it
 * somewhere else, on purpose, overwriting it would silently break whatever
 * stubs they already depend on there. So this only ever writes when the
 * workspace-scoped value is genuinely unset, or already equal to this
 * feature's own path (a repeat sync, safe to no-op) — never when it holds
 * something else. `WorkspaceConfiguration.inspect(...).workspaceValue` is
 * what distinguishes "genuinely unset at this scope" from "resolved to
 * Pylance's own default" — inspecting the *effective* value would conflate
 * the two and refuse to ever write anything, since a value the default
 * already supplies would look identical to one a user chose.
 */

export type StubPathDecision =
  | { readonly kind: "write" }
  | { readonly kind: "already-ours" }
  | { readonly kind: "conflict"; readonly currentValue: string };

/**
 * `currentWorkspaceValue` is `WorkspaceConfiguration.inspect("stubPath")
 * ?.workspaceValue` — `undefined` when nothing has set it at workspace scope
 * (Pylance's own default, or global/user settings, do not count: only a
 * workspace-scoped value can conflict with what this function is about to
 * write at that same scope). `ourValue` is the path this feature would write.
 */
export function decideStubPathAction(
  currentWorkspaceValue: string | undefined,
  ourValue: string,
): StubPathDecision {
  if (currentWorkspaceValue === undefined) return { kind: "write" };
  if (currentWorkspaceValue === ourValue) return { kind: "already-ours" };
  return { kind: "conflict", currentValue: currentWorkspaceValue };
}
