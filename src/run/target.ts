// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The run-target model: ADR-0011's "a specific Viya profile, or Local", as data.
 *
 * **This module must never import `vscode`.** Same discipline as
 * `src/profile/model.ts`: the rules for what a target means, and what running
 * against it right now would do, are worth pinning with fixture-free unit
 * tests rather than being re-derived by hand inside `src/run/commands.ts` or
 * `src/run/statusBar.ts` every time either needs to ask.
 *
 * The stored preference is only ever `"local"` or `"viya"` — never a profile
 * name of its own. ADR-0011 calls the target "a specific profile, or Local",
 * but the specific profile half of that is already answered by
 * `ProfileStore.active()` (ADR-0007): switching profile and switching target
 * are the same gesture in the picker, but they write to two different stores,
 * because "which profile" already has an owner and duplicating it here would
 * give two places a stale copy of the same fact could live in. `"viya"` with
 * no active profile is not an error state — it is the ordinary shape of a
 * fresh install, per ADR-0011's "Default: Viya" — so {@link RunReadiness}
 * gives it its own reason rather than folding it into "local".
 */

/** The two things a workspace can be pointed at. */
export type RunTargetKind = "local" | "viya";

/** Whether `value` is a value this module will accept back from storage. */
export function isRunTargetKind(value: unknown): value is RunTargetKind {
  return value === "local" || value === "viya";
}

/**
 * Reads a stored preference, defaulting to `"viya"` when there is none or it
 * is not recognised.
 *
 * ADR-0011: "Installing this extension is the statement of intent, and local
 * execution already has a button." A value that is not one of the two known
 * strings — `undefined` on a fresh workspace, or anything a future build
 * might have written and this one does not recognise — resolves the same way
 * an absent one does, rather than being treated as a settings error: this is
 * `workspaceState`, which nobody hand-edits, and a mis-shaped read here has no
 * user-facing rejection to report to.
 */
export function resolveRunTargetKind(stored: unknown): RunTargetKind {
  return isRunTargetKind(stored) ? stored : "viya";
}

/** The target, plus the profile it resolves to when it is `"viya"`. */
export interface RunTargetStatus {
  readonly kind: RunTargetKind;
  /** Present only when `kind` is `"viya"` and a profile is active. */
  readonly profileName?: string;
}

/**
 * What running right now would do, given the current target and profile.
 *
 * The "what does this target imply" rule ADR-0011 asks for. Three outcomes,
 * not two, because `"viya"` with no active profile is not the same refusal as
 * `"local"` — one is fixed by choosing a profile, the other by choosing a
 * target — and `src/run/commands.ts` reports each with its own message rather
 * than a single generic "cannot run right now".
 */
export type RunReadiness =
  | { readonly ok: true; readonly profileName: string }
  /**
   * The target is Local. Reaching this from a run command is not the ordinary
   * path — with the target Local, `package.json`'s `editor/title/run` and
   * `editor/context` entries are gated off — but the Command Palette entry
   * has no such gate (ADR-0011: "the palette route is always available and
   * always explicit"), so a command body still has to handle it rather than
   * assume the menu already refused.
   */
  | { readonly ok: false; readonly reason: "local" }
  /** The target is Viya, but no connection profile is active to run against. */
  | { readonly ok: false; readonly reason: "no-profile" };

export function runReadiness(status: RunTargetStatus): RunReadiness {
  if (status.kind === "local") return { ok: false, reason: "local" };
  return status.profileName === undefined
    ? { ok: false, reason: "no-profile" }
    : { ok: true, profileName: status.profileName };
}

/** One entry in the `selectRunTarget` picker. */
export interface RunTargetPickEntry {
  readonly kind: RunTargetKind;
  /** Present only on a `"viya"` entry — one per configured profile. */
  readonly profileName?: string;
  /** Whether this entry is the one the workspace is on right now. */
  readonly current: boolean;
}

/**
 * The picker's contents: **Local Python**, then every configured profile —
 * ADR-0011's "one list… because choosing a profile *is* choosing Viya".
 *
 * Order follows `profileNames` (the settings file's own order, same as
 * `switchProfile`'s picker), not alphabetised, so a user who has arranged
 * their profiles deliberately sees that arrangement here too.
 */
export function runTargetPickEntries(
  profileNames: readonly string[],
  current: RunTargetStatus,
): RunTargetPickEntry[] {
  const entries: RunTargetPickEntry[] = [
    { kind: "local", current: current.kind === "local" },
  ];
  for (const profileName of profileNames) {
    entries.push({
      kind: "viya",
      profileName,
      current: current.kind === "viya" && current.profileName === profileName,
    });
  }
  return entries;
}
