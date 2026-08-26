// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The VS Code shell around `./target`'s model — ADR-0011's `workspaceState`
 * store.
 *
 * Same split as `src/profile/store.ts`: everything that touches
 * `workspaceState` or the profile store lives here, and the rules for what a
 * target means live next door in `./target`, which the unit tier can reach.
 *
 * `workspaceState`, never `globalState` or a setting — ADR-0011's own
 * "Alternatives considered" is explicit that a setting would let a repository
 * decide where a stranger's code runs, the same shape ADR-0002 already
 * restricts the profile settings for. It sits beside
 * `src/profile/store.ts`'s own `ACTIVE_PROFILE_STATE_KEY`, the pointer
 * ADR-0007 put there, carrying the same workspace-not-window qualifier: two
 * windows open on the same folder share one target.
 */

import * as vscode from "vscode";

import type { ProfileStore } from "../profile/store";
import {
  resolveRunTargetKind,
  runReadiness,
  type RunReadiness,
  type RunTargetKind,
  type RunTargetStatus,
} from "./target";

const RUN_TARGET_STATE_KEY = "pythonOnViya.runTarget";

/** The one thing this store needs from the profile store: which profile, if
 * any, is active — and when that changes. Narrowed for the same reason
 * `ComputeProfileSource` is: a test can satisfy two members without a
 * settings file and a configuration listener behind it. */
export type RunTargetProfileSource = Pick<
  ProfileStore,
  "active" | "onDidChange"
>;

/** Narrower than `vscode.ExtensionContext`, matching `ProfileStorageContext`'s
 * own reasoning: a real context satisfies this by structure, and a test does
 * not have to fake a hundred members it never touches. */
export type RunTargetStorageContext = Pick<
  vscode.ExtensionContext,
  "workspaceState"
>;

export class RunTargetStore implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: RunTargetStorageContext,
    private readonly profiles: RunTargetProfileSource,
  ) {
    this.disposables.push(
      this.changed,
      // The status this store answers with depends on which profile is
      // active even when nobody has touched the target itself — switching
      // profile while parked on "viya" changes what running now would do,
      // and the status bar needs to hear about that too.
      this.profiles.onDidChange(() => {
        this.changed.fire();
      }),
    );
  }

  /** Fires when the stored target, or the active profile, changes. */
  get onDidChange(): vscode.Event<void> {
    return this.changed.event;
  }

  /** The stored preference — `"viya"` by default. See `./target`'s own doc. */
  kind(): RunTargetKind {
    return resolveRunTargetKind(
      this.context.workspaceState.get<string>(RUN_TARGET_STATE_KEY),
    );
  }

  /** The target, plus the profile it resolves to when it is `"viya"`. */
  status(): RunTargetStatus {
    const kind = this.kind();
    if (kind === "local") return { kind };
    const active = this.profiles.active();
    return active === undefined ? { kind } : { kind, profileName: active.name };
  }

  /** What running right now would do. See `./target`'s `runReadiness`. */
  readiness(): RunReadiness {
    return runReadiness(this.status());
  }

  /**
   * Sets the target. Never moves it back — see ADR-0011's "The extension
   * never changes the target": every caller of this method is a direct
   * response to the user picking one, never a fallback from inside a failed
   * run.
   */
  async setKind(kind: RunTargetKind): Promise<void> {
    await this.context.workspaceState.update(RUN_TARGET_STATE_KEY, kind);
    this.changed.fire();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }
}
