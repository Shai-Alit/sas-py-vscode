// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `FileSystemProvider` behind the `sasContent:` scheme — this repository's
 * first — so a remote `.py` file opens in an editor and saves back in place.
 *
 * Structure follows: the `stat`/`readFile`/`writeFile` half of
 * `ContentDataProvider` in sassoftware/vscode-sas-extension (Apache-2.0) — read
 * for what it does, not transcribed. Upstream implements `TreeDataProvider`,
 * `FileSystemProvider`, `TextDocumentContentProvider` and
 * `TreeDragAndDropController` on one class; this project keeps them separate
 * (`contentTree.ts` is the tree), and only the editable-file half lands in 6b.
 *
 * Deliberately thin, like `src/content/contentTree.ts`. What a read or a write
 * *is* on the wire lives in `src/content/adapter.ts` (`vscode`-free,
 * unit-tested); the `sasContent:` URI shape lives in `src/content/uri.ts`
 * (likewise). This class is the shell: it turns a URI into a resource href,
 * calls the adapter, and maps a {@link ContentProblem} onto the
 * `vscode.FileSystemError` the editor expects — logging the technical sentence
 * and showing the localised one.
 *
 * The adapter is resolved per call from the deployment root carried in the URI
 * (`src/content/uri.ts`), never from "the active profile" — so a document
 * opened from one deployment keeps reading and writing against that deployment
 * after the user switches profiles, which is what a `FileSystemProvider` (asked
 * to service a URI long after it was handed out — a background save, a
 * `compare:` tab) has to do. With no adapter for that deployment (no profile,
 * or signed out) every call fails `Unavailable` with a sign-in hint rather than
 * a stack trace.
 *
 * ## The lost-update guard lives here
 *
 * `readFile` records the `ETag` it read for each resource in {@link opened},
 * keyed by the resource's deployment root and href together so two Viya roots
 * that happen to share a Files service id keep a guard entry each;
 * `writeFile` sends that tag — the one for the bytes the editor is showing, not
 * a fresh one — as `If-Match`, so a `PUT` after someone else changed the file
 * comes back `412` and the user is told to reopen it. `stat` deliberately does
 * **not** touch {@link opened}: VS Code also calls `stat` at save time, and a
 * tag captured then would already reflect the other person's edit. A `200`
 * refreshes the entry from the `PUT` response so a second save in the same
 * session needs no re-read. A `412` is left in place: the buffer is still the
 * pre-conflict version, so its tag is still the right thing to send — a retry
 * without reopening just `412`s again with the same "reopen it" message,
 * which is the truth, and never a blind overwrite.
 *
 * ## What this slice does not do
 *
 * Structural mutation — `createDirectory`, `delete`, `rename`,
 * `readDirectory` — throws `NoPermissions`. Those are 6c, driven from the tree
 * and its context menu, not the filesystem layer. `watch` is a no-op: nothing
 * polls SAS Content for external changes, and `stat` on the next open is how a
 * change is noticed. The read-only `sasContentReadOnly` scheme upstream uses
 * for recycle-bin content is 6d, with the rest of the recycle bin.
 */

import * as vscode from "vscode";

import { type ContentAdapter, type WritePrecondition } from "./adapter";
import { localiseContentProblem } from "./messages";
import { describeContentProblem, type ContentProblem } from "./problems";
import { parseContentUri } from "./uri";

export class SasContentFileSystemProvider
  implements vscode.FileSystemProvider, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.changed.event;

  /**
   * What `readFile` learned about each resource it has served, keyed by
   * deployment root and `/files/files/{id}` href together (the key {@link resolve}
   * builds): a {@link WritePrecondition} when the read carried an `ETag`, or
   * `null` when it succeeded without one (a proxy stripping the header, or a
   * resource type that does not issue one — finding 6.1 only confirms the header
   * for `.py`). `writeFile` needs the distinction: `null` means "opened, but
   * there is no tag to be conditional against", which is a different refusal
   * from "never opened".
   *
   * The deployment root is part of the key, not just the href: a Files service
   * id is a bare GUID with no deployment in it, so the same id can name a
   * different file on two Viya roots. Keying on the href alone would let a
   * `readFile` against root B overwrite the entry a `readFile` against root A
   * recorded, and the next save on root A would then send root B's tag and draw
   * a spurious `412` the user would read as someone else's edit. The URI already
   * carries its own root for adapter resolution; the guard is scoped the same
   * way.
   */
  private readonly opened = new Map<string, WritePrecondition | null>();

  /**
   * @param adapterForEndpoint Returns the adapter for a given deployment root,
   *   or `undefined` when there is no session for it. Passed the root parsed
   *   from each URI — not "the active profile" — so an open document keeps
   *   talking to its own deployment after a profile switch.
   * @param log The extension's shared channel — every failure is logged here
   *   with its technical sentence before the localised one is thrown.
   */
  constructor(
    private readonly adapterForEndpoint: (
      endpoint: string,
    ) => ContentAdapter | undefined,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  dispose(): void {
    this.changed.dispose();
  }

  watch(): vscode.Disposable {
    // Nothing external notifies this extension of a SAS Content change, so
    // there is nothing to subscribe to. `stat` on the next open catches it.
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { adapter, href } = this.resolve(uri);
    const result = await adapter.statFile(href);
    if (!result.ok) throw this.toFileSystemError(result.problem);
    return {
      type: vscode.FileType.File,
      ctime: result.value.createdAt ?? 0,
      mtime: result.value.modifiedAt ?? 0,
      size: result.value.size,
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { adapter, href, key } = this.resolve(uri);
    const result = await adapter.readFileContent(href);
    if (!result.ok) throw this.toFileSystemError(result.problem);
    this.opened.set(
      key,
      result.value.etag === undefined
        ? null
        : { etag: result.value.etag, contentType: result.value.contentType },
    );
    return result.value.bytes;
  }

  // `options` ({ create, overwrite }) is not read: SAS Content has no notion of
  // a placeholder file, and the tree only ever opens a file that already
  // exists, so every write is an overwrite of a known resource.
  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const { adapter, href, key } = this.resolve(uri);
    const precondition = this.opened.get(key);
    if (precondition === undefined) {
      // No read ever populated the guard. VS Code reads before it lets a file
      // be edited, so this is the pathological "save into a `sasContent:` URI
      // that was never opened" case — refuse rather than overwrite blindly.
      throw new vscode.FileSystemError(
        vscode.l10n.t(
          "Open this file from the SAS Content view before saving it.",
        ),
      );
    }
    if (precondition === null) {
      // Opened, but SAS Viya sent no version tag for it, so a conditional
      // write is not possible — refuse rather than overwrite blindly.
      throw new vscode.FileSystemError(
        vscode.l10n.t(
          "SAS Viya did not return a version tag for this file, so it cannot be saved safely from here. Reopen it and try again, or edit it in SAS Studio.",
        ),
      );
    }
    const result = await adapter.writeFileContent(href, content, precondition);
    if (!result.ok) throw this.toFileSystemError(result.problem);
    // Advance the guard to the tag the server just assigned, so a second save
    // in this session does not need a re-read. If the `PUT` succeeded but
    // carried no tag — finding 6.2 says a `200` always does on the probed
    // deployment, so this is a stripping proxy or another Viya release —
    // invalidate the entry to `null` rather than leave the now-consumed tag in
    // place: a later save then hits the "no version tag, reopen it" refusal
    // above, which is the truth, instead of sending the stale tag and drawing a
    // spurious `412` the user would read as someone else's edit.
    if (result.value.etag !== undefined) {
      this.opened.set(key, {
        etag: result.value.etag,
        contentType: precondition.contentType,
      });
    } else {
      this.opened.set(key, null);
    }
    // No `onDidChangeFile` fire: the editor already holds the buffer it just
    // saved, and announcing a change to the URI it wrote invites a needless
    // re-read. `stat` on the next open is how an *external* change is noticed.
  }

  // Structural mutation is 6c — driven from the tree, not here.
  readDirectory(): [string, vscode.FileType][] {
    throw vscode.FileSystemError.NoPermissions(
      vscode.l10n.t("Browse SAS Content from the SAS Content view."),
    );
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions(
      vscode.l10n.t("Creating folders in SAS Content is not supported yet."),
    );
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions(
      vscode.l10n.t("Deleting SAS Content is not supported yet."),
    );
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions(
      vscode.l10n.t("Renaming SAS Content is not supported yet."),
    );
  }

  /** The adapter for the deployment a `sasContent:` URI names, the file-resource
   * href it carries, and the {@link opened} key for that (root, href) pair — or
   * a thrown `FileSystemError` when the URI is not one this extension wrote or
   * there is no session for its deployment. */
  private resolve(uri: vscode.Uri): {
    adapter: ContentAdapter;
    href: string;
    key: string;
  } {
    const parts = parseContentUri(uri.query);
    if (parts === undefined) throw vscode.FileSystemError.FileNotFound(uri);
    const adapter = this.adapterForEndpoint(parts.deploymentRoot);
    if (adapter === undefined) {
      throw vscode.FileSystemError.Unavailable(
        vscode.l10n.t("Sign in to SAS Viya to open SAS Content files."),
      );
    }
    // Guard key: deployment root + href, `\n`-joined. Neither a URL nor a
    // `/files/files/{guid}` href contains a newline, so one pair can never
    // collide with another. Built from the parsed parts rather than
    // `uri.toString()` so two URIs that differ only in query encoding still
    // resolve to the same entry.
    return {
      adapter,
      href: parts.resourceHref,
      key: `${parts.deploymentRoot}\n${parts.resourceHref}`,
    };
  }

  /** Log the technical sentence, return the `FileSystemError` to throw. The
   * editor tab already shows which file, so every arm carries the localised
   * explanation rather than the URI. */
  private toFileSystemError(problem: ContentProblem): vscode.FileSystemError {
    this.log.error(
      vscode.l10n.t("SAS Content: {0}", describeContentProblem(problem)),
    );
    const message = localiseContentProblem(problem);
    switch (problem.code) {
      case "content-rejected":
        // The string overload keeps the `FileNotFound` code while showing
        // "this file no longer exists on the server" rather than VS Code's
        // generic "File not found (…)".
        if (problem.error.status === 404) {
          return vscode.FileSystemError.FileNotFound(message);
        }
        return new vscode.FileSystemError(message);
      case "forbidden":
        return vscode.FileSystemError.NoPermissions(message);
      case "unauthorized":
        // `noSession` is the "no token could be obtained" origin (client.ts):
        // there is no live session for this deployment, so the user is signed
        // out for it — the same state `resolve()` catches when there is no
        // adapter at all. Give the sign-in prompt. Every other `unauthorized`
        // keeps `localiseAuthProblem`'s wording, including a bare-challenge
        // `not-authenticated`: the auth layer defines that as a dropped
        // `Authorization` header — our bug — and words it "please report this",
        // so sending that user to sign in again is a loop that cannot fix it.
        if (problem.noSession === true) {
          return vscode.FileSystemError.Unavailable(
            vscode.l10n.t("Sign in to SAS Viya to open SAS Content files."),
          );
        }
        return vscode.FileSystemError.Unavailable(message);
      case "content-unreachable":
        return vscode.FileSystemError.Unavailable(message);
      case "link-missing":
      case "foreign-link":
      case "response-malformed":
        return new vscode.FileSystemError(message);
    }
  }
}
