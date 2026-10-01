// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `FileSystemProvider` behind the `pythonOnViyaServer:` scheme, so a file
 * on the compute server opens in an editor and saves back in place.
 *
 * Thin, like `src/content/contentFileSystem.ts`. Its lost-update guard, which
 * sends the `ETag` the editor's read returned rather than upstream's empty
 * `If-Match` (Finding 13.26), is `src/server/editorFiles.ts`, unit-tested
 * there.
 *
 * The URI carries the profile id and the server path, not a session-bound
 * href (ADR-0047), and each call looks up that profile's session now. A file
 * opened before the session ended saves after the user reconnects. With no
 * session, a call fails `Unavailable` with a Connect hint.
 *
 * Creating, deleting and renaming through this provider are refused: 13p-ii
 * does those from the tree.
 */

import * as vscode from "vscode";

import { type ServerAdapter } from "./adapter";
import { type ServerEditorFiles } from "./editorFiles";
import { localiseServerProblem } from "./messages";
import { parseServerUri, type ServerUriParts } from "./path";
import { describeServerProblem, type ServerProblem } from "./problems";

export class SasServerFileSystemProvider
  implements vscode.FileSystemProvider, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.changed.event;

  /**
   * @param adapterFor The adapter for a profile id, for `stat`. Always
   *   returns one; the adapter itself reports `not-connected` when that
   *   profile has no session.
   * @param editorFiles The read and save path, with its `ETag` guard.
   * @param log The shared channel every failure is logged to.
   * @param forgetProfile Drops a connection a call found gone.
   */
  constructor(
    private readonly adapterFor: (profileId: string) => ServerAdapter,
    private readonly editorFiles: ServerEditorFiles,
    private readonly log: vscode.LogOutputChannel,
    private readonly forgetProfile: (profileId: string) => void,
  ) {}

  dispose(): void {
    this.changed.dispose();
  }

  watch(): vscode.Disposable {
    // Nothing notifies the extension of a change on the server.
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const parts = this.resolve(uri);
    const result = await this.adapterFor(parts.profileId).stat(parts.path);
    if (!result.ok) throw this.toError(parts.profileId, result.problem);
    const item = result.value;
    return {
      type: item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
      ctime: 0,
      mtime: item.modifiedAt ?? 0,
      size: item.size ?? 0,
      ...(item.readOnly ? { permissions: vscode.FilePermission.Readonly } : {}),
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const parts = this.resolve(uri);
    const result = await this.editorFiles.read(parts);
    if (!result.ok) throw this.toError(parts.profileId, result.problem);
    return result.value;
  }

  // `options` is not read: the tree only opens a file that exists, so every
  // write is an overwrite of a file this provider read.
  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const parts = this.resolve(uri);
    const result = await this.editorFiles.write(parts, content);
    if (!result.ok) throw this.toError(parts.profileId, result.problem);
  }

  readDirectory(): [string, vscode.FileType][] {
    throw vscode.FileSystemError.NoPermissions(
      vscode.l10n.t("Browse the SAS server from the SAS Server view."),
    );
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions(
      vscode.l10n.t("Creating folders on the SAS server is not supported yet."),
    );
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions(
      vscode.l10n.t("Deleting files on the SAS server is not supported yet."),
    );
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions(
      vscode.l10n.t("Renaming files on the SAS server is not supported yet."),
    );
  }

  private resolve(uri: vscode.Uri): ServerUriParts {
    const parts = parseServerUri(uri.query);
    if (parts === undefined) throw vscode.FileSystemError.FileNotFound(uri);
    return parts;
  }

  /** Logs the technical sentence and returns the error to throw. */
  private toError(
    profileId: string,
    problem: ServerProblem,
  ): vscode.FileSystemError {
    this.log.error(
      vscode.l10n.t("SAS Server: {0}", describeServerProblem(problem)),
    );
    const message = localiseServerProblem(problem);
    switch (problem.code) {
      case "not-connected":
        return vscode.FileSystemError.Unavailable(
          vscode.l10n.t(
            "Connect to SAS Viya to open or save files on the SAS server.",
          ),
        );
      case "path-not-found":
        return vscode.FileSystemError.FileNotFound(message);
      case "wrong-kind":
        return problem.expected === "file"
          ? vscode.FileSystemError.FileIsADirectory(message)
          : vscode.FileSystemError.FileNotADirectory(message);
      case "changed-on-server":
      case "too-large":
      case "no-version":
        return new vscode.FileSystemError(message);
      case "compute":
        switch (problem.problem.code) {
          case "session-gone":
            this.forgetProfile(profileId);
            return vscode.FileSystemError.Unavailable(
              vscode.l10n.t(
                "The SAS Viya session ended. Connect again, then retry.",
              ),
            );
          case "forbidden":
            return vscode.FileSystemError.NoPermissions(message);
          case "unauthorized":
          case "compute-unreachable":
            return vscode.FileSystemError.Unavailable(message);
          default:
            return new vscode.FileSystemError(message);
        }
    }
  }
}
