// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A notebook cell displays its result (ADR-0046, 13f).
 *
 * **This module must never import `vscode`.** Same discipline as
 * `procPython.ts`, which is its one caller.
 *
 * Jupyter shows a cell's trailing expression and its open matplotlib
 * figures; `PROC PYTHON` runs a file as a script and shows neither. So a
 * notebook cell runs through two fixed Python helpers instead of directly:
 *
 * - {@link CELL_RUNNER_SOURCE}, in {@link CELL_RUNNER_FILEREF_NAME}, reads the
 *   cell's file, runs every statement but a trailing expression, then
 *   evaluates that expression and displays its value: `_repr_html_` first,
 *   then `_repr_png_`, then `repr()` printed to the log. A trailing `;`
 *   suppresses it, as in Jupyter. HTML and PNG are written beside the cell's
 *   file, where the ADR-0019 directory diff finds them.
 * - {@link FIGURE_FLUSH_SOURCE}, in {@link FIGURE_FLUSH_FILEREF_NAME}, saves
 *   each open matplotlib figure beside the cell's file and then closes them
 *   all. It runs as its own step, after the cell's, so it runs whether the
 *   cell raised or not.
 *
 * Both helpers find the cell's file through the macro variable
 * {@link CELL_PATH_NAME}, an absolute path from `%sysfunc(pathname())`:
 * Python's working directory is the user's to change, and after an
 * `os.chdir` a relative write would land outside the directory the Files API
 * lists (Finding 13.19). Both remove their one global name when they finish,
 * so nothing leaks into the cell's namespace (Finding 13.16).
 *
 * The cell's `Program.bytes` still reach the interpreter unmodified, through
 * the run's own fileref (ADR-0014). The runner compiles them under the name
 * `<string>`, the label `PROC PYTHON infile=` already gives them, so a
 * traceback frame still maps to the cell's own line numbers
 * (`tracebackDiagnostics.ts`).
 */

import { type LogLine } from "../compute/job";

/** The fileref the cell runner is uploaded to. Outside the `PYnnnnnn` range
 * `procPython.ts` counts, like `PYVSTART`. */
export const CELL_RUNNER_FILEREF_NAME = "PYVRUN";

/** The fileref the figure flush is uploaded to. */
export const FIGURE_FLUSH_FILEREF_NAME = "PYVFLUSH";

/** The macro variable holding the cell file's absolute path. */
const CELL_PATH_NAME = "PYVIYA_CELL";

/** The cell runner's own function. Its frame sits between `PROC PYTHON`'s
 * `<stdin>` frames and the cell's own in every traceback the cell raises
 * (Finding 13.16), and `parseTraceback` drops it. */
export const RUNNER_FUNCTION_NAME = "_pyviya_run_cell";

/**
 * The cell runner, as probed (Finding 13.16).
 *
 * - The cell is parsed with `compile(..., ast.PyCF_ONLY_AST)` rather than
 *   `ast.parse`, so a syntax error raises from the runner's frame and not
 *   from inside `ast.py`.
 * - `dont_inherit=True` keeps the runner's own `__future__` flags out of the
 *   cell. The trailing expression is compiled with the flags the cell's own
 *   `from __future__` imports set.
 * - `end_col_offset` counts UTF-8 bytes, so the `;` check reads the source
 *   line as bytes.
 * - A `_repr_html_` or `_repr_png_` that raises is skipped, and one line on
 *   `stderr` names it, as IPython's formatter warning does. One that is
 *   missing or returns the wrong type is skipped silently. A class is shown
 *   by its `repr()`, as in IPython, since its repr methods need an instance.
 *   IPython's `(data, metadata)` tuple form is accepted.
 */
export const CELL_RUNNER_SOURCE: readonly string[] = [
  `def ${RUNNER_FUNCTION_NAME}():`,
  "    import __future__, ast, importlib.util, os, sys",
  `    path = SAS.symget("${CELL_PATH_NAME}").strip()`,
  "    folder, cell = os.path.split(path)",
  "    namespace = globals()",
  '    with open(path, "rb") as handle:',
  "        source = handle.read()",
  '    tree = compile(source, "<string>", "exec", ast.PyCF_ONLY_AST, dont_inherit=True)',
  "    last = None",
  "    if tree.body and isinstance(tree.body[-1], ast.Expr):",
  "        last = tree.body.pop()",
  '    code = compile(tree, "<string>", "exec", dont_inherit=True)',
  "    exec(code, namespace)",
  "    if last is None:",
  "        return",
  "    flags = 0",
  "    for feature in __future__.all_feature_names:",
  "        flags |= getattr(__future__, feature).compiler_flag & code.co_flags",
  '    expression = compile(ast.Expression(last.value), "<string>", "eval", flags, dont_inherit=True)',
  "    value = eval(expression, namespace)",
  "    if value is None:",
  "        return",
  '    lines = importlib.util.decode_source(source).split("\\n")',
  '    if lines[last.end_lineno - 1].encode("utf-8")[last.end_col_offset:].lstrip().startswith(b";"):',
  "        return",
  '    for method, suffix, kind in (("_repr_html_", ".html", str), ("_repr_png_", ".png", bytes)):',
  "        try:",
  "            render = None if isinstance(value, type) else getattr(value, method, None)",
  "            data = None if render is None else render()",
  "        except Exception as error:",
  '            print(type(value).__name__ + "." + method + "() raised " + repr(error) + "; showing the value another way.", file=sys.stderr)',
  "            continue",
  "        if isinstance(data, tuple) and data:",
  "            data = data[0]",
  "        if isinstance(data, kind):",
  '            name = os.path.join(folder, "pyviya_" + cell + "_out" + suffix)',
  '            with open(name, "wb") as handle:',
  '                handle.write(data.encode("utf-8") if kind is str else data)',
  "            return",
  "    print(repr(value))",
  "try:",
  `    ${RUNNER_FUNCTION_NAME}()`,
  "finally:",
  `    globals().pop("${RUNNER_FUNCTION_NAME}", None)`,
];

/**
 * The figure flush, as probed (Finding 13.16). It does nothing unless the
 * cell imported `matplotlib.pyplot`, so it never imports matplotlib itself.
 * `plt.show()` does not close a figure under the `agg` backend, so a figure
 * the cell showed is still flushed. The figures are closed even when saving
 * one fails.
 */
export const FIGURE_FLUSH_SOURCE: readonly string[] = [
  "def _pyviya_flush_figures():",
  "    import os, sys",
  '    pyplot = sys.modules.get("matplotlib.pyplot")',
  "    if pyplot is None:",
  "        return",
  `    folder, cell = os.path.split(SAS.symget("${CELL_PATH_NAME}").strip())`,
  "    try:",
  "        for index, number in enumerate(pyplot.get_fignums(), start=1):",
  '            name = os.path.join(folder, "pyviya_" + cell + "_plot" + format(index, "03d") + ".png")',
  '            pyplot.figure(number).savefig(name, format="png", bbox_inches="tight")',
  "    finally:",
  '        pyplot.close("all")',
  "try:",
  "    _pyviya_flush_figures()",
  "finally:",
  '    globals().pop("_pyviya_flush_figures", None)',
];

function encodeSource(lines: readonly string[]): Uint8Array {
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

/** {@link CELL_RUNNER_SOURCE}, as uploaded. */
export const CELL_RUNNER_BYTES: Uint8Array = encodeSource(CELL_RUNNER_SOURCE);

/** {@link FIGURE_FLUSH_SOURCE}, as uploaded. */
export const FIGURE_FLUSH_BYTES: Uint8Array = encodeSource(FIGURE_FLUSH_SOURCE);

/**
 * The statements that run one cell through the runner, in place of
 * `proc python infile=<fileref>; run;`. `restart` composes with `infile=` the
 * same way it does for a plain run (finding 35). The path is not macro-quoted:
 * the server chooses it, and a `&` or `%` in it is accepted as not arising.
 */
export function cellRunnerStatements(
  filerefName: string,
  restart: boolean,
): readonly string[] {
  return [
    `%let ${CELL_PATH_NAME}=%sysfunc(pathname(${filerefName}));`,
    `proc python ${restart ? "restart " : ""}infile=${CELL_RUNNER_FILEREF_NAME};`,
    "run;",
  ];
}

/** The macro variable the cell step's `SYSCC` is held in while the flush
 * runs. */
const USER_SYSCC_NAME = "PYVIYA_USERCC";

/** The macro variable the flush step's `SYSCC` is saved in. */
export const FLUSH_SYSCC_NAME = "PYVIYA_FLUSHCC";

/** The flush step's first statement. Its `source` echo is where the cell's
 * log ends and the flush's begins (Finding 13.18). */
export const FLUSH_BOUNDARY_STATEMENT = `%let ${USER_SYSCC_NAME}=&syscc;`;

/**
 * The flush step, after the cell's. `SYSCC` is saved before it and put back
 * after it, so `SYSCC` after the job describes the cell alone, and a failing
 * flush cannot fail the cell (Finding 13.17).
 *
 * `SYSERRORTEXT` is not saved. A flush that fails after a cell that failed
 * with a SAS error, not a Python exception, leaves the flush's text there,
 * and the cell's failure message is then the flush's. That takes a cell
 * failing in SAS and a figure failing to save, and the cell's own `ERROR`
 * line is still in its output, so it is accepted.
 */
export const FIGURE_FLUSH_STEP: readonly string[] = [
  FLUSH_BOUNDARY_STATEMENT,
  "%let syscc=0;",
  `proc python infile=${FIGURE_FLUSH_FILEREF_NAME};`,
  "run;",
  `%let ${FLUSH_SYSCC_NAME}=&syscc;`,
  `%let syscc=&${USER_SYSCC_NAME};`,
];

/** Whether a log line is the `source` echo of
 * {@link FLUSH_BOUNDARY_STATEMENT} (Finding 13.18). The echo carries SAS's
 * line number in front, so the end of the line is matched. */
export function isFlushBoundary(logLine: LogLine): boolean {
  return (
    logLine.type === "source" &&
    logLine.line.trimEnd().endsWith(FLUSH_BOUNDARY_STATEMENT)
  );
}
