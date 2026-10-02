<!--
  GENERATED FILE — DO NOT EDIT.

  Produced by scripts/generate-reference.mjs from package.json.
  Run `npm run docs:reference` after changing a contribution point, and commit
  the result. CI fails if this file does not match what package.json produces.
-->

# Settings

Every setting contributed by **Python on Viya**, generated from `package.json`.

| Setting | Type | Default | Scope | Description |
| --- | --- | --- | --- | --- |
| `pythonOnViya.connectionProfiles` | `object` | `{}` | `window` | SAS Viya connection profiles, keyed by the name you want to see in the status bar. Normally managed by the profile commands, but hand-editing is supported and validated. No client secret is stored here: secrets go to the editor's secret storage, and a profile containing one would be a credential in a file you can commit. † |
| `pythonOnViya.defaultProfile` | `string` | `""` | `window` | Name of the connection profile a window starts on. Switching profile overrides this for the current workspace only, so this setting is the one a machine setup script or a checked-in workspace file can rely on. Ignored if it names a profile that does not exist. † |
| `pythonOnViya.userProvidedCertificates` | `array` | `[]` | `machine` | Absolute paths to PEM certificate files to trust when connecting to SAS Viya, for a deployment behind a private certificate authority or one that serves an incomplete chain. Each file is added to a dedicated HTTPS agent used only for this extension's requests, so it does not change what any other extension trusts. When this list has any value it replaces the operating-system certificate store for the extension's Viya requests, so it must name every authority the connection needs — including any corporate proxy or inspection root you already rely on. Read once when the window loads; a change takes effect on the next reload. A path that cannot be read is reported in the Python on Viya log and the others are still used. Machine-scoped so that a checked-in workspace settings file cannot widen TLS trust. |
| `pythonOnViya.pylanceStubs.enabled` | `boolean` | `true` | `window` | Write generated Pylance stubs for packages that are on the Viya profile but not installed locally, and point `python.analysis.stubPath` at them, each time the environment is probed. Turn off to stop. Turning it off does not remove stubs already written: delete the `.pythonOnViya` folder and the `python.analysis.stubPath` setting yourself. |
| `pythonOnViya.csvExport.guardFormulaInjection` | `boolean` | `false` | `window` | Guard a character column's cell against CSV/formula injection when exporting a SAS library or CAS table to CSV (`Export to CSV`). A cell beginning with `=`, `+`, `-`, `@`, a tab, a carriage return, or a line feed is prefixed with a leading `'` so a spreadsheet program (Excel, Google Sheets, LibreOffice Calc) opens it as literal text instead of evaluating it as a formula. Off by default: every export is written exactly as the server returns it unless you turn this on. Never applied to a numeric column, so a negative number is never affected. Exporting a SAS library table costs one extra request per export to read its column types. |
| `pythonOnViya.sasServer.showHiddenFiles` | `boolean` | `false` | `window` | Show files and folders whose names start with `.` in the **SAS Server** view. |
| `pythonOnViya.cas.tokenFileref` | `string` | `"CASTOKEN"` | `window` | The name **Insert CAS Connection Snippet** and **Refresh CAS Token** write the CAS access token under, in the Compute session's working directory. Python code can open it by that name, `open("CASTOKEN")` by default, in every session once one of these commands has run in it, so code that reads it can be committed and shared. Running either command again replaces the token in the same file. A SAS fileref name: 1 to 8 letters, digits or underscores, not starting with a digit; it is upper-cased when used. `PYVSTART` and `PY` followed by six digits are this extension's own and are refused. If your own SAS code has already assigned a fileref with this name, the commands say so and write nothing. |
| `pythonOnViya.notebook.dataFrameGrid.maxRows` | `integer` | `100` | `window` | How many rows of a pandas DataFrame a notebook cell shows as a sortable grid, when the DataFrame is the cell's last expression. Sorting applies to the rows shown. `0` shows the DataFrame as an HTML table instead, as Jupyter does. The HTML table stays available through **Change Presentation** on the cell's output. |
| `pythonOnViya.notebook.dataFrameGrid.maxColumns` | `integer` | `20` | `window` | How many columns of a pandas DataFrame a notebook cell shows as a sortable grid, not counting its index. `0` shows the DataFrame as an HTML table instead. |

† **Restricted in untrusted workspaces.** The workspace-scoped value is ignored
until you trust the folder, because acting on it would run code on a remote
server under your identity. See
[ADR-0002](../adr/0002-workspace-trust-posture.md).
