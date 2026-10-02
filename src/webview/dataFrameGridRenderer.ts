// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The notebook renderer for a DataFrame grid (ADR-0048, 13g).
 *
 * VS Code loads this module in the notebook's own browser frame for an
 * output item of {@link DATAFRAME_GRID_MIME}, through the `notebookRenderer`
 * contribution in `package.json`, and calls `activate`. It shows the item as
 * an `ag-grid-community` grid (ADR-0028) whose columns sort on the rows the
 * item carries, with the item's summary line above it.
 *
 * - The item is checked by the same parser the host used
 *   (`dataFrameGrid.ts`), since a saved notebook can carry anything under
 *   this mime. One that fails throws, and VS Code shows the error in the
 *   output; "Change Presentation" still offers the HTML.
 * - Every cell is text. ag-grid's default cell renderer writes a value as
 *   text, never as markup, and no column here names another renderer.
 * - Column formatting and order are `dataFrameGridModel.ts`'s, which the
 *   unit tier tests; this file only wires them to ag-grid, and is excluded
 *   from coverage like every other file in `src/webview/` (ADR-0009).
 * - The grid's colours and font follow the VS Code theme, through the
 *   `--vscode-*` variables the notebook frame defines.
 * - `requiresMessaging` is `"never"`: the renderer never talks to the host.
 *
 * The renderer API's types come from `@types/vscode-notebook-renderer`,
 * which this project does not install; the two it needs are declared here,
 * narrowed to what this file uses.
 */

import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  createGrid,
  themeQuartz,
  type ColDef,
  type GridApi,
} from "ag-grid-community";

import {
  DATAFRAME_GRID_MIME,
  parseDataFrameGridOutput,
  type DataFrameCell,
} from "../backend/dataFrameGrid";
import {
  compareCells,
  fitsWithoutScrolling,
  formatCell,
  gridColumns,
  gridRows,
  type GridColumn,
  type GridRow,
} from "../notebook/dataFrameGridModel";

/** The part of the renderer API's `OutputItem` this renderer reads. */
interface OutputItem {
  readonly id: string;
  readonly mime: string;
  json(): unknown;
}

/** The part of the renderer API's `RendererApi` this renderer provides. */
interface RendererApi {
  renderOutputItem(item: OutputItem, element: HTMLElement): void;
  disposeOutputItem(id?: string): void;
}

/** The grid's height when it scrolls rather than grows. */
const SCROLLING_HEIGHT_PX = 420;

/** A text column wider than this wraps its header and cuts its cells. */
const MAX_COLUMN_WIDTH_PX = 480;

const theme = themeQuartz.withParams({
  backgroundColor: "var(--vscode-editor-background)",
  foregroundColor: "var(--vscode-editor-foreground)",
  borderColor: "var(--vscode-editorWidget-border, var(--vscode-panel-border))",
  chromeBackgroundColor: "var(--vscode-editorWidget-background)",
  accentColor: "var(--vscode-focusBorder)",
  fontFamily: "var(--vscode-font-family)",
  headerFontWeight: 600,
});

/** VS Code calls this once, when the first grid in a notebook renders. */
export function activate(): RendererApi {
  const grids = new Map<string, GridApi<GridRow>>();

  const dispose = (id: string): void => {
    grids.get(id)?.destroy();
    grids.delete(id);
  };

  return {
    renderOutputItem(item, element) {
      dispose(item.id);
      if (item.mime !== DATAFRAME_GRID_MIME) {
        throw new Error(`Unexpected output type ${item.mime}`);
      }
      const parsed = parseDataFrameGridOutput(item.json());
      if (!parsed.ok) {
        throw new Error(`Not a DataFrame grid: ${parsed.reason}`);
      }
      const grid = parsed.value;
      const rows = gridRows(grid);
      const fits = fitsWithoutScrolling(rows.length);

      const summary = document.createElement("div");
      summary.textContent = grid.summary;
      summary.style.margin = "0 0 4px";
      summary.style.opacity = "0.8";

      const host = document.createElement("div");
      host.style.width = "100%";
      if (!fits) host.style.height = `${String(SCROLLING_HEIGHT_PX)}px`;
      element.replaceChildren(summary, host);

      const api = createGrid<GridRow>(
        host,
        {
          theme,
          columnDefs: gridColumns(grid.fields).map(toColumnDef),
          rowData: rows,
          domLayout: fits ? "autoHeight" : "normal",
          defaultColDef: { maxWidth: MAX_COLUMN_WIDTH_PX },
          autoSizeStrategy: { type: "fitCellContents" },
          enableCellTextSelection: true,
          ensureDomOrder: true,
          suppressFieldDotNotation: true,
        },
        {
          modules: [
            ClientSideRowModelModule,
            CellStyleModule,
            ColumnAutoSizeModule,
          ],
        },
      );
      grids.set(item.id, api);
    },

    disposeOutputItem(id) {
      if (id !== undefined) {
        dispose(id);
        return;
      }
      for (const key of [...grids.keys()]) dispose(key);
    },
  };
}

function toColumnDef(column: GridColumn): ColDef<GridRow, DataFrameCell> {
  return {
    field: column.key,
    headerName: column.header,
    sortable: true,
    valueFormatter: (params) => formatCell(params.value, column.kind),
    comparator: (a, b) => compareCells(a, b, column.kind),
    // ag-grid's own classes, as the data viewer uses them
    // (`dataViewerEntry.tsx`'s `toColumnDefs`).
    ...(column.kind === "number"
      ? {
          cellClass: "ag-right-aligned-cell",
          headerClass: "ag-right-aligned-header",
        }
      : {}),
    ...(column.index ? { cellStyle: { fontWeight: "600" } } : {}),
  };
}
