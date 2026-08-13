// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The VS Code shell around the profile model.
 *
 * Everything that touches `workspace.getConfiguration`, `workspaceState` or
 * `SecretStorage` lives here and nowhere else, and — the part that matters —
 * *only* that. There is no validation in this file, no normalisation and no
 * precedence logic; all of it is in `model.ts`, which the unit tier can reach.
 * Anything that drifts in here stops being cheaply testable, which is how a test
 * suite quietly stops being a specification. If a change to this file needs a new
 * `if`, the `if` probably belongs next door.
 *
 * Structure follows: client/src/components/profile.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied. That file is
 * the model, the settings I/O and the input prompts in one class, and reading it
 * is what suggested the split. See docs/adr/0007-connection-profile-storage.md.
 */

import * as vscode from "vscode";

import {
  readProfiles,
  resolveActiveProfile,
  secretKey,
  withSecretlessId,
  type ProfileProblem,
  type ReadProfilesResult,
  type ViyaProfile,
} from "./model";

/** The configuration section every setting in this extension hangs off. */
const SECTION = "pythonOnViya";
const PROFILES_KEY = "connectionProfiles";
const DEFAULT_PROFILE_KEY = "defaultProfile";

/**
 * Where this window's chosen profile is remembered.
 *
 * `workspaceState` is keyed to the *workspace*, not to the window, and the
 * difference is worth being straight about: two windows open on the same folder
 * do share this value. That is a far smaller blast radius than upstream's single
 * global setting — a development workspace and a production workspace stay
 * independent, which is the case that costs money to get wrong — and there is no
 * per-window store in the API to do better with. Accepted knowingly.
 */
const ACTIVE_PROFILE_STATE_KEY = "pythonOnViya.activeProfile";

/**
 * Profiles whose OAuth client is registered without a secret.
 *
 * `globalState`, not `workspaceState`: profiles are user-global, and so is this
 * fact about them. Not `SecretStorage`, for the reason set out on `setSecret`.
 */
const SECRETLESS_IDS_KEY = "pythonOnViya.clientsWithoutSecret";

/**
 * The part of `ExtensionContext` this store actually uses.
 *
 * Narrower than `vscode.ExtensionContext` on purpose, and not for tidiness: a
 * real context can only be obtained by being an extension, so a test that wants
 * to prove what this class stores where would otherwise have to assert its way
 * past a hundred members it does not implement — or cast, which this repository
 * does not allow. Three named members can be supplied honestly. `activate` still
 * passes the real context, which satisfies this by structure.
 */
export type ProfileStorageContext = Pick<
  vscode.ExtensionContext,
  "secrets" | "workspaceState" | "globalState"
>;

export class ProfileStore implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  /**
   * The rejection reasons last written to the log, joined.
   *
   * Configuration change events fire often and for reasons that have nothing to
   * do with us, so repeating the same complaint each time would bury the log it
   * is trying to be useful in. Only a *change* in what is wrong gets reported.
   */
  private reportedProblems = "";

  constructor(
    private readonly context: ProfileStorageContext,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      this.changed,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(`${SECTION}.${PROFILES_KEY}`) ||
          event.affectsConfiguration(`${SECTION}.${DEFAULT_PROFILE_KEY}`)
        ) {
          this.changed.fire();
        }
      }),
    );
  }

  /** Fires when the profile list, the default, or this window's choice changes. */
  get onDidChange(): vscode.Event<void> {
    return this.changed.event;
  }

  /**
   * Every profile that survived validation, plus the ones that did not.
   *
   * Reading never writes. Upstream's equivalent repairs the setting from inside
   * its getters, so merely opening the settings UI can rewrite `settings.json`;
   * a read that has a side effect is a read you cannot reason about.
   */
  read(): ReadProfilesResult {
    const result = readProfiles(
      vscode.workspace.getConfiguration(SECTION).get<unknown>(PROFILES_KEY),
    );
    this.reportProblems(result.rejected);
    return result;
  }

  /** Profile names, in the order the settings file lists them. */
  names(): string[] {
    return Object.keys(this.read().profiles);
  }

  get(name: string): ViyaProfile | undefined {
    return this.read().profiles[name];
  }

  /** The name of the profile this window should be using, or `undefined`. */
  activeName(): string | undefined {
    return resolveActiveProfile({
      profileNames: this.names(),
      windowChoice: this.context.workspaceState.get<string>(
        ACTIVE_PROFILE_STATE_KEY,
      ),
      defaultProfile: vscode.workspace
        .getConfiguration(SECTION)
        .get<string>(DEFAULT_PROFILE_KEY),
    });
  }

  /** The active profile itself, or `undefined` when there is nothing to use. */
  active(): { name: string; profile: ViyaProfile } | undefined {
    const name = this.activeName();
    if (name === undefined) return undefined;
    const profile = this.get(name);
    return profile === undefined ? undefined : { name, profile };
  }

  /**
   * Points this window at a profile, or clears the choice so the default applies
   * again. Passing a name that does not exist is allowed and simply resolves
   * through, which is what makes the pointer safe to leave behind after a delete.
   */
  async setActiveName(name: string | undefined): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_PROFILE_STATE_KEY, name);
    this.changed.fire();
  }

  /** Adds a profile or replaces one under the same name. */
  async upsert(name: string, profile: ViyaProfile): Promise<void> {
    const { profiles } = this.read();
    await this.write({ ...profiles, [name]: profile });
  }

  /**
   * Renames a profile.
   *
   * The stored secret is untouched on purpose: it is keyed on the profile's `id`,
   * which a rename does not change. Upstream keys its credential on the name, so
   * a rename there silently orphans the token and the next sign-in prompt arrives
   * with no explanation.
   */
  async rename(from: string, to: string): Promise<void> {
    const { profiles } = this.read();
    const profile = profiles[from];
    if (profile === undefined) return;

    // Rebuilt in order rather than deleted from, so the renamed profile keeps its
    // position in settings.json instead of jumping to the end of the file.
    const next: Record<string, ViyaProfile> = {};
    for (const [key, value] of Object.entries(profiles)) {
      next[key === from ? to : key] = value;
    }
    await this.write(next);

    if (
      this.context.workspaceState.get<string>(ACTIVE_PROFILE_STATE_KEY) === from
    ) {
      await this.setActiveName(to);
    }
  }

  /** Deletes a profile and the secret stored against it. */
  async remove(name: string): Promise<void> {
    const { profiles } = this.read();
    const profile = profiles[name];
    if (profile === undefined) return;

    await this.write(
      Object.fromEntries(
        Object.entries(profiles).filter(([key]) => key !== name),
      ),
    );
    await this.clearSecret(profile);

    if (
      this.context.workspaceState.get<string>(ACTIVE_PROFILE_STATE_KEY) === name
    ) {
      await this.setActiveName(undefined);
    }
  }

  /**
   * The profile's client secret: the stored one, `""` if the client is known to
   * have none, or `undefined` if nobody has said yet.
   *
   * Three states rather than two, because "no secret" and "not asked" are
   * different facts and only one of them is a reason to prompt.
   */
  async secret(profile: ViyaProfile): Promise<string | undefined> {
    const stored = await this.context.secrets.get(secretKey(profile));
    if (stored !== undefined) return stored;
    return this.secretlessIds().includes(profile.id) ? "" : undefined;
  }

  /**
   * Records what the user answered. **`""` means "this client has no secret"**
   * and is remembered as such, so it is asked once rather than at every sign-in.
   *
   * The empty answer is deliberately *not* written to `SecretStorage`, which is
   * the obvious shortcut and does not work. VS Code encrypts a secret before
   * storing it and, on read, discards the entry when the **stored** value is
   * falsy — with the OS keyring that is fine, because `""` encrypts to a
   * non-empty blob, but when the keyring is unavailable the storage falls back
   * to an in-memory backend where encryption is the identity function. There
   * `""` is stored as `""` and read back as `undefined`. That is a Linux
   * container, a remote-SSH host without a keyring, and CI — precisely the
   * environments where the bug would be blamed on something else. Verified
   * against the shipped `workbench.desktop.main.js` for 1.133.0.
   *
   * So a fact about configuration is stored as configuration, in `globalState`
   * alongside the profiles it describes, and the secret store keeps only secrets.
   */
  async setSecret(profile: ViyaProfile, value: string): Promise<void> {
    if (value === "") {
      // Any previously stored secret is now contradicted, not merely unused.
      await this.context.secrets.delete(secretKey(profile));
      await this.rememberSecretless(profile.id, true);
      return;
    }
    await this.rememberSecretless(profile.id, false);
    await this.context.secrets.store(secretKey(profile), value);
  }

  /** Forgets both the stored secret and any claim that there is none. */
  async clearSecret(profile: ViyaProfile): Promise<void> {
    await this.rememberSecretless(profile.id, false);
    await this.context.secrets.delete(secretKey(profile));
  }

  private secretlessIds(): readonly string[] {
    return this.context.globalState.get<string[]>(SECRETLESS_IDS_KEY) ?? [];
  }

  private async rememberSecretless(
    id: string,
    secretless: boolean,
  ): Promise<void> {
    const current = this.secretlessIds();
    const next = withSecretlessId(current, id, secretless);
    // Every real secret written goes through here to retract a claim that is
    // almost never there. Writing anyway would mean a `globalState` update, and
    // a sync of it, on every sign-in that has nothing to record.
    const unchanged =
      next.length === current.length && next.every((v, i) => v === current[i]);
    if (unchanged) return;

    await this.context.globalState.update(
      SECRETLESS_IDS_KEY,
      next.length === 0 ? undefined : next,
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  /**
   * Writes the profile dictionary back.
   *
   * The target is chosen rather than hard-coded. Profiles are user-global, so
   * `Global` is the normal answer — but if a workspace has already overridden the
   * setting, a global write is invisible: the workspace value still wins and the
   * user's edit appears to have been discarded. Writing where the value the user
   * can see actually lives is the only behaviour that is not confusing. Upstream
   * hard-codes `Global` (`profile.ts:245,301,326`).
   */
  private async write(profiles: Record<string, ViyaProfile>): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(SECTION);
    const inspected = configuration.inspect<unknown>(PROFILES_KEY);
    const target =
      inspected?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;

    await configuration.update(PROFILES_KEY, profiles, target);
    this.changed.fire();
  }

  private reportProblems(rejected: readonly ProfileProblem[]): void {
    const summary = rejected
      .map(({ name, reason }) => `${name}: ${reason}`)
      .join("\n");
    if (summary === this.reportedProblems) return;
    this.reportedProblems = summary;

    for (const { name, reason } of rejected) {
      this.log.warn(
        name === ""
          ? vscode.l10n.t("Connection profiles could not be read: {0}", reason)
          : vscode.l10n.t('Ignoring profile "{0}": {1}', name, reason),
      );
    }
  }
}
