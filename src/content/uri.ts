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
 * returns); `deploymentRoot` is the active profile's endpoint. `#`/`?` in the
 * name are escaped; the href rides raw (a `/files/files/{guid}` has no
 * query-reserved character); the root is percent-encoded because it is a URL.
 */
export function contentUriString(
  name: string,
  resourceHref: string,
  deploymentRoot: string,
): string {
  const safeName = name.replace(/#/g, "%23").replace(/\?/g, "%3F");
  return (
    `${CONTENT_SCHEME}:/${safeName}` +
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
