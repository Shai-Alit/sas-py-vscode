// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `sasContent:` URI a tree file node opens, and the file-resource href
 * carried inside it.
 *
 * **This module must never import `vscode`.** The shell
 * (`src/content/contentTree.ts`, `src/content/contentFileSystem.ts`) wraps
 * these strings in `vscode.Uri.parse` / reads `uri.query`; the shape decisions
 * are here so they are unit-testable without an extension host.
 *
 * Structure follows: `getSasContentUri` / `getResourceId` in
 * `client/src/connection/rest/util.ts` of sassoftware/vscode-sas-extension
 * (Apache-2.0). No code was copied.
 *
 * ## Why the href rides in the query, unescaped
 *
 * Upstream builds `sasContent:/<name>?id=<resourceHref>` and reads the href
 * straight back with `uri.query.substring(3)` — the href is never
 * percent-encoded because a Files service resource href is
 * `/files/files/{guid}` and carries no query-reserved character (`&`, `#`,
 * `?`). {@link resourceHrefOfQuery} parses it the same way, and
 * {@link contentUriString} only escapes `#`/`?` in the *name* segment, which is
 * user-controlled and can contain anything. The `FileSystemProvider` is keyed
 * on the scheme, and the href in the query is the only thing it needs to
 * resolve a read or a write — the path segment is cosmetic (it gives the editor
 * tab its title and the file its `.py` extension for language detection).
 */

/** The `FileSystemProvider` scheme for editable SAS Content files. */
export const CONTENT_SCHEME = "sasContent";

/** The query prefix the file-resource href follows. */
const ID_PREFIX = "id=";

/**
 * The `sasContent:` URI string for a file member.
 *
 * `resourceHref` is the member's own `uri` (`/files/files/{guid}` — finding
 * 99), i.e. what {@link resourceHrefOf} returns. Only `#` and `?` in `name`
 * are escaped; everything after `?id=` is the href verbatim.
 */
export function contentUriString(name: string, resourceHref: string): string {
  const safeName = name.replace(/#/g, "%23").replace(/\?/g, "%3F");
  return `${CONTENT_SCHEME}:/${safeName}?${ID_PREFIX}${resourceHref}`;
}

/**
 * The file-resource href carried in a `sasContent:` URI's query, or `undefined`
 * when the query is not one this extension wrote (`id=…` prefix, non-empty
 * value).
 */
export function resourceHrefOfQuery(query: string): string | undefined {
  if (!query.startsWith(ID_PREFIX)) return undefined;
  const href = query.slice(ID_PREFIX.length);
  return href === "" ? undefined : href;
}
