// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The profile commands: add, edit, delete, switch, import.
 *
 * This file is prompts and sequencing. Every rule it enforces comes from
 * `model.ts` — which is what lets the input boxes validate as you type rather
 * than at the end, because `validateInput` can call the same function the tests
 * call. There is no second copy of the rules here, and there should never be one.
 *
 * Cancelling any step abandons the whole command and writes nothing. That is the
 * reason each flow gathers everything first and saves last, rather than saving as
 * it goes: a half-entered profile that got persisted because the user pressed
 * Escape at the wrong moment is a worse outcome than losing three keystrokes.
 *
 * Structure follows: client/src/commands/profile.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied.
 * See docs/adr/0007-connection-profile-storage.md.
 */

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";

import {
  scanSasProfiles,
  SAS_PROFILES_SETTING,
  type ImportCandidate,
} from "./import";
import {
  createProfile,
  normaliseEndpoint,
  validateProfileName,
  type ViyaProfile,
} from "./model";
import { localiseProblem } from "./problems";
import { type ProfileStore } from "./store";

/** Context key backing the `enablement` clauses in `package.json`. */
const HAS_PROFILES = "pythonOnViya.hasProfiles";

export function registerProfileCommands(
  context: vscode.ExtensionContext,
  store: ProfileStore,
  log: vscode.LogOutputChannel,
): void {
  const syncContextKey = (): void => {
    void vscode.commands.executeCommand(
      "setContext",
      HAS_PROFILES,
      store.names().length > 0,
    );
  };
  syncContextKey();

  context.subscriptions.push(
    store.onDidChange(syncContextKey),
    vscode.commands.registerCommand("pythonOnViya.addProfile", () =>
      addProfile(store, log),
    ),
    vscode.commands.registerCommand("pythonOnViya.editProfile", () =>
      editProfile(store, log),
    ),
    vscode.commands.registerCommand("pythonOnViya.deleteProfile", () =>
      deleteProfile(store, log),
    ),
    vscode.commands.registerCommand("pythonOnViya.switchProfile", () =>
      switchProfile(store),
    ),
    vscode.commands.registerCommand("pythonOnViya.importProfiles", () =>
      importProfiles(store, log),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Prompts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The shared shape of an input box that validates with a model function.
 *
 * `validateInput` returns the model's own rejection reason, so the message in
 * the input box and the message in the log are the same sentence. Two wordings
 * for one rule is how they drift apart.
 */
async function askValidated(options: {
  prompt: string;
  placeHolder?: string | undefined;
  value?: string | undefined;
  password?: boolean | undefined;
  validate: (input: string) => string | undefined;
}): Promise<string | undefined> {
  // The conditional spreads are what `exactOptionalPropertyTypes` asks for: an
  // absent option and an option explicitly set to `undefined` are different
  // things to the compiler, and only the first is what we mean here.
  return await vscode.window.showInputBox({
    prompt: options.prompt,
    ...(options.placeHolder === undefined
      ? {}
      : { placeHolder: options.placeHolder }),
    ...(options.value === undefined ? {} : { value: options.value }),
    password: options.password ?? false,
    ignoreFocusOut: true,
    validateInput: options.validate,
  });
}

async function askName(
  store: ProfileStore,
  current?: string,
): Promise<string | undefined> {
  const existing = store.names();
  const name = await askValidated({
    prompt: vscode.l10n.t("Profile name"),
    placeHolder: vscode.l10n.t("Production"),
    value: current,
    validate: (input) => {
      const result = validateProfileName(input, existing, { allow: current });
      return result.ok ? undefined : localiseProblem(result.problem);
    },
  });
  return name?.trim();
}

async function askEndpoint(current?: string): Promise<string | undefined> {
  const raw = await askValidated({
    prompt: vscode.l10n.t("SAS Viya endpoint"),
    placeHolder: "https://viya.example.com",
    value: current,
    validate: (input) => {
      const result = normaliseEndpoint(input);
      return result.ok ? undefined : localiseProblem(result.problem);
    },
  });
  if (raw === undefined) return undefined;

  // Re-run rather than trusting the box: `validateInput` gates the OK button,
  // but the normalised form is what we store, and only the model can produce it.
  const result = normaliseEndpoint(raw);
  return result.ok ? result.value : undefined;
}

/** Optional free text. An empty answer is a real answer, so `""` is not `undefined`. */
async function askOptional(
  prompt: string,
  placeHolder: string,
  current?: string,
): Promise<string | undefined> {
  return await vscode.window.showInputBox({
    prompt,
    placeHolder,
    ...(current === undefined ? {} : { value: current }),
    ignoreFocusOut: true,
  });
}

/**
 * Collects the client secret, masked.
 *
 * `password: true` is the whole point of this function existing separately.
 * Upstream prompts for the same value without it, so the secret is visible while
 * it is typed and then stored somewhere it stays visible.
 */
async function askSecret(prompt: string): Promise<string | undefined> {
  return await askValidated({
    prompt,
    password: true,
    validate: () => undefined,
  });
}

async function pickProfile(
  store: ProfileStore,
  title: string,
): Promise<string | undefined> {
  const { profiles } = store.read();
  const items = Object.entries(profiles).map(([name, profile]) => ({
    label: name,
    description: profile.endpoint,
  }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("There are no connection profiles yet."),
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: vscode.l10n.t("Select a connection profile"),
  });
  return picked?.label;
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

async function addProfile(
  store: ProfileStore,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const name = await askName(store);
  if (name === undefined) return;

  const endpoint = await askEndpoint();
  if (endpoint === undefined) return;

  const computeContext = await askOptional(
    vscode.l10n.t("Compute context (optional — you can choose one later)"),
    vscode.l10n.t("SAS Job Execution compute context"),
  );
  if (computeContext === undefined) return;

  const clientId = await askOptional(
    // Naming the version is the difference between a prompt someone can act on
    // and one they have to guess at. "The default" means nothing to a user on
    // an older Viya 4, who is precisely the person who must not leave this
    // empty.
    vscode.l10n.t(
      "OAuth client ID (optional — leave empty on Viya 4 2022.11 and later)",
    ),
    vscode.l10n.t("client-id"),
  );
  if (clientId === undefined) return;

  const profile = createProfile({
    id: randomUUID(),
    endpoint,
    context: computeContext,
    clientId,
  });

  if (profile.clientId !== undefined) {
    const secret = await askSecret(
      vscode.l10n.t("Client secret (optional — leave empty if there is none)"),
    );
    if (secret === undefined) return;
    // Unconditional, empty included: the prompt says "leave empty if there is
    // none", so an empty box is an answer to record, not one to drop. Compare
    // the edit command below, where the same empty box means something else.
    await store.setSecret(profile, secret);
  }

  await store.upsert(name, profile);
  log.info(vscode.l10n.t('Added connection profile "{0}".', name));

  // The first profile becomes this window's, because the alternative is adding a
  // profile and having nothing visibly change.
  if (store.names().length === 1) await store.setActiveName(name);
}

async function editProfile(
  store: ProfileStore,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const originalName = await pickProfile(
    store,
    vscode.l10n.t("Edit Connection Profile"),
  );
  if (originalName === undefined) return;

  const existing = store.get(originalName);
  if (existing === undefined) return;

  const name = await askName(store, originalName);
  if (name === undefined) return;

  const endpoint = await askEndpoint(existing.endpoint);
  if (endpoint === undefined) return;

  const computeContext = await askOptional(
    vscode.l10n.t("Compute context (optional)"),
    vscode.l10n.t("SAS Job Execution compute context"),
    existing.context,
  );
  if (computeContext === undefined) return;

  const clientId = await askOptional(
    vscode.l10n.t(
      "OAuth client ID (optional — leave empty on Viya 4 2022.11 and later)",
    ),
    vscode.l10n.t("client-id"),
    existing.clientId,
  );
  if (clientId === undefined) return;

  const updated: ViyaProfile = {
    ...createProfile({
      id: existing.id,
      endpoint,
      context: computeContext,
      clientId,
    }),
  };

  if (updated.clientId === undefined) {
    // No client id means no client secret to go with it. Leaving the old secret
    // behind would keep a credential the user believes they have just removed.
    await store.clearSecret(updated);
  } else {
    // A secret belongs to the client it was issued for, so changing the client
    // id changes what the question means. Keep the same one and an empty box
    // means "I did not retype it"; swap it for another client and the same empty
    // box has to mean "this one has none", because there is nothing left worth
    // keeping. Asking the wrong one of those two carries a secret across to a
    // client it will not authenticate.
    const sameClient = updated.clientId === existing.clientId;
    const secret = await askSecret(
      sameClient
        ? vscode.l10n.t("Client secret (leave empty to keep the stored one)")
        : vscode.l10n.t(
            "Client secret (optional — leave empty if there is none)",
          ),
    );
    if (secret === undefined) return;
    // Nothing is written until there is an answer: clearing the old secret up
    // front would destroy it for a user who then pressed Escape.
    if (!sameClient || secret !== "") await store.setSecret(updated, secret);
  }

  if (name !== originalName) await store.rename(originalName, name);
  await store.upsert(name, updated);
  log.info(vscode.l10n.t('Updated connection profile "{0}".', name));
}

async function deleteProfile(
  store: ProfileStore,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const name = await pickProfile(
    store,
    vscode.l10n.t("Delete Connection Profile"),
  );
  if (name === undefined) return;

  // Modal, because this also destroys the stored secret and there is no undo.
  const confirm = vscode.l10n.t("Delete");
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('Delete the connection profile "{0}"?', name),
    { modal: true, detail: vscode.l10n.t("Its stored secret is deleted too.") },
    confirm,
  );
  if (answer !== confirm) return;

  await store.remove(name);
  log.info(vscode.l10n.t('Deleted connection profile "{0}".', name));
}

/**
 * A profile in the switch list. `name` is absent on the "use the default" entry,
 * which is exactly how that entry says "clear the override".
 */
interface SwitchItem extends vscode.QuickPickItem {
  name?: string | undefined;
}

async function switchProfile(store: ProfileStore): Promise<void> {
  const { profiles } = store.read();
  const activeName = store.activeName();

  const items: SwitchItem[] = Object.entries(profiles).map(
    ([name, profile]) => ({
      label: name,
      description: profile.endpoint,
      ...(name === activeName
        ? { detail: vscode.l10n.t("Currently in use") }
        : {}),
      name,
    }),
  );

  if (items.length === 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("There are no connection profiles yet."),
    );
    return;
  }

  // Offered only when it would do something: clearing the override is
  // meaningless unless a default exists for it to fall back to.
  const defaultProfile = vscode.workspace
    .getConfiguration("pythonOnViya")
    .get<string>("defaultProfile");
  if (defaultProfile !== undefined && defaultProfile in profiles) {
    items.push({
      label: vscode.l10n.t("Use the default"),
      description: defaultProfile,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t("Switch Connection Profile"),
    placeHolder: vscode.l10n.t("Select a connection profile"),
  });
  if (picked === undefined) return;

  await store.setActiveName(picked.name);
}

/**
 * Imports Viya profiles from the SAS extension.
 *
 * Read-only with respect to their settings, and it stays that way. The SAS
 * extension terminates a running compute session on any change to its profile
 * key, so writing there would be shipping a defect into somebody else's product.
 */
/** An importable SAS profile in the multi-select pick. */
interface CandidateItem extends vscode.QuickPickItem {
  candidate: ImportCandidate;
}

async function importProfiles(
  store: ProfileStore,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const section = SAS_PROFILES_SETTING.slice(
    0,
    SAS_PROFILES_SETTING.indexOf("."),
  );
  const key = SAS_PROFILES_SETTING.slice(SAS_PROFILES_SETTING.indexOf(".") + 1);
  const raw = vscode.workspace.getConfiguration(section).get<unknown>(key);

  const { candidates, skipped } = scanSasProfiles(raw, {
    makeId: () => randomUUID(),
    existingNames: store.names(),
  });

  for (const { name, reason } of skipped) {
    log.info(vscode.l10n.t('Not importing "{0}": {1}', name, reason));
  }

  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      skipped.length === 0
        ? vscode.l10n.t(
            "The SAS extension has no connection profiles to import.",
          )
        : vscode.l10n.t(
            "None of the {0} SAS connection profiles can be used with Python on Viya. See the log for details.",
            skipped.length,
          ),
    );
    return;
  }

  const items: CandidateItem[] = candidates.map((candidate) => ({
    label: candidate.name,
    description: candidate.profile.endpoint,
    ...(candidate.name === candidate.originalName
      ? {}
      : {
          detail: vscode.l10n.t('Renamed from "{0}"', candidate.originalName),
        }),
    picked: true,
    candidate,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t("Import Connection Profiles from the SAS Extension"),
    placeHolder: vscode.l10n.t("Select the profiles to import"),
    canPickMany: true,
  });
  if (picked === undefined || picked.length === 0) return;

  for (const { candidate } of picked) {
    await store.upsert(candidate.name, candidate.profile);
  }
  log.info(vscode.l10n.t("Imported {0} connection profile(s).", picked.length));

  // The client secret is never copied. It lives in the SAS extension's own
  // settings, and the honest thing is to say so rather than to move a credential
  // between extensions on the user's behalf.
  const needSecrets = picked.filter(
    ({ candidate }) => candidate.hadClientSecret,
  );
  if (needSecrets.length > 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t(
        "Imported. You will be asked for the client secret the first time you connect, because secrets are not copied between extensions.",
      ),
    );
  }

  if (store.names().length === picked.length) {
    await store.setActiveName(picked[0]?.candidate.name);
  }
}
