// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What a download from the SAS Server view writes: the server's
 * {@link DownloadTree} for `src/content/transfer.ts`'s planner, which 13a
 * wrote for SAS Content and 13p-ii made generic.
 *
 * **This module must never import `vscode`.**
 *
 * A folder is keyed by its path. Every listed item is a file or a folder
 * (Finding 13.22), so nothing is left out as `not-a-file`. A folder more than
 * {@link MAX_SERVER_DOWNLOAD_DEPTH} names deep is left out as `too-deep`:
 * the listing does not say which folders are symbolic links, so a link back
 * to a parent would otherwise be walked until the paths grew too long. Links
 * were not probed.
 */

import {
  planTreeDownload,
  type DownloadPlan,
  type DownloadTree,
} from "../content/transfer";
import {
  type CallOptions,
  type ServerAdapter,
  type ServerFailure,
  type ServerResult,
} from "./adapter";
import { type ServerItem } from "./types";

/** The deepest folder a download walks into, counting the chosen item as
 * one. */
export const MAX_SERVER_DOWNLOAD_DEPTH = 32;

/** What the tree needs from an adapter. */
export type ServerListingAdapter = Pick<ServerAdapter, "getChildren">;

/** The SAS Server view's {@link DownloadTree}. A listing cut short at the
 * adapter's page limit is downloaded as far as it was listed, and the folder
 * is reported as `listing-truncated` so the summary says something was left
 * out. */
export function serverDownloadTree(
  adapter: ServerListingAdapter,
): DownloadTree<ServerItem, ServerItem, ServerFailure> {
  return {
    nameOf: (item) => item.name,
    isFolder: (item) => item.isDirectory,
    folderKey: (item) => item.path,
    // Asked only of an item `isFolder` said no to, and every such item is a
    // file with its own `getFile` link.
    fileSource: (item) => item,
    listChildren: async (folder, signal) => {
      const options: CallOptions = signal === undefined ? {} : { signal };
      const listing = await adapter.getChildren(folder, options);
      return listing.ok
        ? {
            ok: true,
            value: listing.value.items,
            truncated: listing.value.truncated,
          }
        : listing;
    },
    maxDepth: MAX_SERVER_DOWNLOAD_DEPTH,
  };
}

/** Plans the download of `item` from the SAS server. */
export async function planServerDownload(
  adapter: ServerListingAdapter,
  item: ServerItem,
  signal?: AbortSignal,
): Promise<ServerResult<DownloadPlan<ServerItem>>> {
  return await planTreeDownload(serverDownloadTree(adapter), item, signal);
}
