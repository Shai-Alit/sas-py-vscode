// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The read-only virtual document behind `Python on Viya: Show environment`.
 *
 * The one `vscode`-importing module for this feature — same split
 * `resultPanel.ts` draws against `resultPanelDom.ts`: `environmentDocument.ts`
 * arranges already-translated text into the document body, and this module
 * supplies the translations, builds the document's URI, and is the one place
 * that talks to `vscode.workspace.registerTextDocumentContentProvider`.
 *
 * A profile's cached probe (`environmentStore.ts`) is looked up **live**, on
 * every `provideTextDocumentContent` call, rather than captured once at open
 * time — that is what lets {@link EnvironmentDocumentProvider.refresh} make
 * an already-open tab show a freshly probed answer just by firing
 * `onDidChange` for its URI, the standard `TextDocumentContentProvider`
 * refresh mechanism, rather than this feature inventing its own.
 */

import * as vscode from "vscode";

import {
  renderEnvironmentDocument,
  type EnvironmentSnapshot,
} from "./environmentDocument";
import { type StoredEnvironment } from "./environmentStore";

/** This feature's own URI scheme — nothing else in this codebase registers
 * a `TextDocumentContentProvider`, so there is no existing one to share. */
export const ENVIRONMENT_SCHEME = "pythonOnViyaEnvironment";

const PROFILE_ID_PARAM = "profileId";
const PROFILE_NAME_PARAM = "profileName";

/**
 * The document's URI for one profile.
 *
 * Both the id and the human name travel in the query string — the id is what
 * {@link EnvironmentDocumentProvider} reads to know which cache entry to
 * render, and the name is carried alongside rather than reconstructed from
 * the path, since a profile name (`profile/model.ts`'s user-editable settings
 * text) is not guaranteed filename-safe and a lossy round trip through a
 * sanitised path would show the wrong name back. The path itself exists only
 * so the editor tab shows something recognisable rather than an opaque id;
 * it is never read back.
 */
export function environmentDocumentUri(
  profileId: string,
  profileName: string,
): vscode.Uri {
  return vscode.Uri.from({
    scheme: ENVIRONMENT_SCHEME,
    path: `/${sanitiseForPath(profileName)}.pythonEnvironment`,
    query: `${PROFILE_ID_PARAM}=${encodeURIComponent(profileId)}&${PROFILE_NAME_PARAM}=${encodeURIComponent(profileName)}`,
  });
}

/** Cosmetic only — the editor tab title. Never decoded back; see this
 * module's own doc on {@link environmentDocumentUri}. */
function sanitiseForPath(name: string): string {
  return name.replace(/[/\\]/g, "_");
}

function readProfileId(uri: vscode.Uri): string | undefined {
  return new URLSearchParams(uri.query).get(PROFILE_ID_PARAM) ?? undefined;
}

function readProfileName(uri: vscode.Uri): string {
  return new URLSearchParams(uri.query).get(PROFILE_NAME_PARAM) ?? "";
}

export class EnvironmentDocumentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  /** A narrow port onto `EnvironmentStore.get`, matching every other class in
   * this codebase that takes only the one method it actually calls. */
  constructor(
    private readonly lookup: (
      profileId: string,
    ) => StoredEnvironment | undefined,
  ) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const profileId = readProfileId(uri);
    const stored = profileId === undefined ? undefined : this.lookup(profileId);

    if (stored?.capabilities.kind !== "available") {
      // Reachable in the ordinary course of things, not only a defect: a
      // probe that fails leaves nothing to cache, and this provider is never
      // the thing that reports that failure (`commands.ts`'s own
      // `reportProblem` is) — a caller only opens this document after a
      // successful probe, but VS Code can still re-invoke this method later
      // (a reload, a `git`-style diff view) against a cache that has since
      // been cleared.
      return vscode.l10n.t(
        "This profile's Python environment has not been probed yet.",
      );
    }

    const snapshot: EnvironmentSnapshot = stored.capabilities;
    const profileName = readProfileName(uri);
    const probedAtDisplay = new Intl.DateTimeFormat(vscode.env.language, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(stored.probedAt));

    return renderEnvironmentDocument(profileName, probedAtDisplay, snapshot, {
      title: vscode.l10n.t("Python on Viya — environment"),
      profileLabel: vscode.l10n.t("Profile"),
      probedLabel: vscode.l10n.t("Probed"),
      interpreterLabel: vscode.l10n.t("Interpreter"),
      executableLabel: vscode.l10n.t("Executable"),
      packagesHeading: (count) =>
        vscode.l10n.t("{0} installed packages:", count),
      noPackages: vscode.l10n.t("No packages were reported."),
    });
  }

  /** Tells VS Code to re-render an already-open document for this profile —
   * call once the store has a fresher answer for it. A no-op for a profile
   * with no open tab; VS Code only re-invokes {@link provideTextDocumentContent}
   * for a URI it is actually displaying. */
  refresh(profileId: string, profileName: string): void {
    this.changeEmitter.fire(environmentDocumentUri(profileId, profileName));
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
