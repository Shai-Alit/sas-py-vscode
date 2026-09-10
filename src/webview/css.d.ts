// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Lets `dataViewerEntry.tsx` (7b, ADR-0028) `import "ag-grid-community/styles/
 * ag-grid.css"` and its theme stylesheet without `tsc` rejecting the specifier
 * outright. `ag-grid-community` ships no type declarations for its own CSS
 * exports (their `package.json` exports map has entries for the `.css` files,
 * but nothing under `types`), and TypeScript has no built-in understanding of
 * a bare side-effect import into a stylesheet — this is the same ambient
 * `declare module "*.css"` every bundler-based React project carries for
 * exactly this reason. Only `esbuild.mjs`'s own `dataViewerContext` gives
 * these imports runtime meaning (bundling the referenced CSS into the
 * companion `dist/webview/dataViewer.css` this panel's own `buildHtml` links
 * — `dataViewerPanel.ts`'s own doc comment on that function has the rest);
 * this file exists purely so `tsc -p tsconfig.webview.json --noEmit` does not
 * fail on the same import esbuild already knows how to handle.
 *
 * Scoped to `src/webview/`'s own type space (this file's location, picked up
 * by `tsconfig.webview.json`'s `src/webview/**\/*.ts` glob) rather than placed
 * anywhere `tsconfig.json`/`tsconfig.test.json` would see it: neither of those
 * programs includes a file that imports a stylesheet, and a global ambient
 * declaration reachable from the extension-host type space would silently
 * tolerate a `.css` import appearing somewhere it should never be able to.
 */
declare module "*.css";
