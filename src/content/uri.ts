// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `sasContent:` URI a tree file node opens, and the two things carried
 * inside it: the file-resource href and the deployment it lives on.
 *
 * **This module must never import `vscode`.** The shell
 * (`src/content/contentTree.ts`, `src/content/contentFileSystem.ts`) wraps
 * these strings in `vscode.Uri.parse` / reads `uri.query`; the shape decisions
 * are here so they are unit-testable without an extension host.
 *
 * Structure follows: `getSasContentUri` / `getResourceId` in
 * `client/src/connection/rest/util.ts` of sassoftware/vscode-sas-extension
 * (Apache-2.0). No code was copied — and the deployment root below is this
 * project's own addition, not something upstream carries.
 *
 * ## Why the deployment root is in the URI
 *
 * A `FileSystemProvider` is asked to service a URI long after it was created —
 * a background auto-save, a `compare:` tab, a save after the user switched
 * connection profiles. It must not resolve against "whichever profile is
 * active right now": a file opened from deployment A would then read and write
 * against deployment B, yielding spurious `404`s or, worse, touching the wrong
 * server if the id happens to exist there. So the URI carries the deployment
 * root (`r=`, percent-encoded) alongside the file href (`id=`), and
 * `SasContentFileSystemProvider` resolves the adapter for *that* root every
 * time — an already-open document keeps talking to the deployment it came
 * from. The path segment stays cosmetic: it gives the editor tab its title and
 * the file its `.py` extension.
 */

/** The `FileSystemProvider` scheme for editable SAS Content files. */
export const CONTENT_SCHEME = "sasContent";

/**
 * The scheme for a **read-only** view of a SAS Content file — a recycled file,
 * opened from the Recycle Bin (6d-ii). The same {@link SasContentFileSystemProvider}
 * serves it, registered a second time with `isReadonly: true`, so the query
 * shape and {@link parseContentUri} are shared; only the scheme differs. Mirrors
 * upstream's `sasContentReadOnly` scheme.
 */
export const CONTENT_READONLY_SCHEME = "sasContentReadOnly";

/**
 * The scheme for a folder's `TreeItem.resourceUri` — identity only, never
 * opened, never registered with a `FileSystemProvider`. Added 2026-09-11
 * (ADR-0031): a folder was previously built with no `resourceUri` at all
 * (only an openable file leaf got one). This is the one concrete, confirmed
 * structural difference between this project's `TreeDragAndDropController`
 * (which mostly failed to recognise a folder row as a same-tree drop
 * target, live-tested) and `vscode-sas-extension`'s own `ContentDataProvider`
 * (confirmed to drag reliably in the same environment), which sets a
 * `resourceUri` unconditionally on every item, container or not — the
 * mechanism is correlational, not verified against VS Code's own source; see
 * ADR-0031's Context for the full reasoning and its limits. A folder is never
 * "opened" the way a file is (no `vscode.open` command is attached), so
 * this scheme is deliberately inert: nothing calls `workspace.fs.*` on it,
 * and nothing should ever register a provider for it. If that ever changes,
 * it stops being safe to reuse this scheme as-is.
 */
export const CONTENT_FOLDER_SCHEME = "sasContentFolder";

/** The file href and the deployment it belongs to, read out of a
 * `sasContent:` URI's query. */
export interface ContentUriParts {
  /** The Files service resource href — `/files/files/{guid}` (finding 99). */
  readonly resourceHref: string;
  /** The deployment root the file lives on — the profile endpoint, already
   * normalised by `src/profile/model.ts`. */
  readonly deploymentRoot: string;
}

/**
 * The `sasContent:` URI string for a file member on a given deployment.
 *
 * `resourceHref` is the member's own `uri` (what {@link resourceHrefOf}
 * returns); `deploymentRoot` is the active profile's endpoint. `%`, `#` and `?`
 * in the name are percent-encoded — `%` first, so the other two escapes are not
 * themselves double-encoded — so a legal-but-unusual SAS Content name like
 * `100% done.py` still round-trips through `vscode.Uri.parse`; the href rides
 * raw (a `/files/files/{guid}` has no query-reserved character); the root is
 * percent-encoded because it is a URL.
 */
export function contentUriString(
  name: string,
  resourceHref: string,
  deploymentRoot: string,
): string {
  return buildContentUri(CONTENT_SCHEME, name, resourceHref, deploymentRoot);
}

/**
 * The `sasContentReadOnly:` URI string for a recycled file (6d-ii) — the same
 * shape as {@link contentUriString}, under the read-only scheme, so opening it
 * lands in {@link SasContentFileSystemProvider}'s read path but the editor never
 * offers to save it.
 */
export function contentReadOnlyUriString(
  name: string,
  resourceHref: string,
  deploymentRoot: string,
): string {
  return buildContentUri(
    CONTENT_READONLY_SCHEME,
    name,
    resourceHref,
    deploymentRoot,
  );
}

/**
 * The `sasContentFolder:` identity URI for a folder-shaped item — see
 * {@link CONTENT_FOLDER_SCHEME}. Same shape as {@link contentUriString} so
 * `parseContentUri` still reads it, on the off chance anything ever needs to,
 * but nothing currently does.
 */
export function contentFolderUriString(
  name: string,
  resourceHref: string,
  deploymentRoot: string,
): string {
  return buildContentUri(
    CONTENT_FOLDER_SCHEME,
    name,
    resourceHref,
    deploymentRoot,
  );
}

function buildContentUri(
  scheme: string,
  name: string,
  resourceHref: string,
  deploymentRoot: string,
): string {
  const safeName = name
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
  return (
    `${scheme}:/${safeName}` +
    `?id=${resourceHref}&r=${encodeURIComponent(deploymentRoot)}`
  );
}

/**
 * The file href and deployment root a `sasContent:` URI carries, or `undefined`
 * when the query is not one this extension wrote (both `id` and `r` present and
 * non-empty).
 */
export function parseContentUri(query: string): ContentUriParts | undefined {
  const params = new URLSearchParams(query);
  const resourceHref = params.get("id");
  const deploymentRoot = params.get("r");
  if (
    resourceHref === null ||
    resourceHref === "" ||
    deploymentRoot === null ||
    deploymentRoot === ""
  ) {
    return undefined;
  }
  return { resourceHref, deploymentRoot };
}
