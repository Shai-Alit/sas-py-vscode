---
name: "python-on-viya"
description: "How Python actually executes when a workspace runs it on SAS Viya through the python-on-viya VS Code extension (PROC PYTHON, upload-plus-infile= submission, SYSCC as the real success signal, the interpreter banner and >>> prompts as inherent noise, one-run-at-a-time, library/CAS access via the SAS bridge object and swat). Use whenever writing, debugging, or explaining Python meant to run on a Viya profile in this workspace — before assuming the code behaves like a normal interactive REPL or a plain PROC PYTHON SUBMIT block."
---

This workspace runs Python through the **python-on-viya** VS Code extension,
against a SAS Viya Compute session, via `PROC PYTHON`. That execution model has
several properties that are not what you'd assume from an ordinary Python REPL
or from a naive `PROC PYTHON SUBMIT` block, and getting them wrong produces
advice or code that looks reasonable and doesn't work — or works but reports
the wrong thing as an error. Read this before writing, debugging, or explaining
code meant to run there.

## How your code actually reaches the interpreter

**Every run uploads your code as a file and executes it with `proc python
infile=<fileref>;` — it is never inlined into a `submit;`/`endsubmit;` block.**
The bytes you see in the editor are the bytes the interpreter reads, unparsed
and unescaped, because nothing tokenises them as SAS source first. Two
consequences:

- **A stray `endsubmit;`-like string in your own source is not a hazard here.**
  Don't add defensive escaping, don't rewrite a docstring to avoid the word, and
  don't warn a user about it — that risk exists only for the inline-`submit`
  design this project deliberately does not use.
- **There is no meaningful sense in which your code is "echoed to the log and
  then run."** The file's source is not echoed at all. What you see in the
  transcript is Python's own output plus SAS's own `NOTE`s around the step.

## `SYSCC`, not job/run state, is what "succeeded" means

A run reporting "finished" is not the same as the code having succeeded — read
or reason about the actual outcome, not the job's terminal state. In this
project's own terms:

- `0` — no error.
- `1012` — an unhandled Python exception.
- `3000` — a SAS-side syntax error.

If you're asked to debug "the run said it finished but nothing happened" or
"it says success but the output is wrong," this is the first thing to suspect,
not a race condition or a caching problem.

**A failed SAS step does not carry into the next run.** `SYSCC` describes
the current job only. Every job the extension submits starts with
`options nosyntaxcheck;`, and resets `OBS` to `MAX` if it is `0`, so a
failing `SAS.submit()` step cannot leave the session in SAS's syntax-check
mode (Finding 12.19). If every run after one failure reports the same old
error, the extension is older than this fix. Reconnecting clears it.

**Don't confuse this with `sessionConditionCode`.** A bad profile-level
`autoExec` line surfaces as a *different*, session-level field
(`sessionConditionCode`, checked once when the session is created), not as
`SYSCC` — `SYSCC` is read per submitted job, after the session already
exists. If a user's session comes up `idle` with no run ever attempted,
`SYSCC` isn't the signal to reach for.

## The interpreter banner and `>>>` prompts are not a bug

A run's transcript includes a `Python 3.x … / Type "help" …` banner (on **Run
File**, and on the first **Run Selection** after connecting or a reset) and
bare `>>>` lines around your code's own output. **This is inherent to `PROC
PYTHON`** — it drives your code through an interactive interpreter and has no
option to suppress either — and the extension deliberately does not strip
them, because code that legitimately prints something starting with `>>>` must
not have it silently removed. Don't tell a user this indicates a
misconfiguration, and don't suggest a flag or setting to turn it off — none
exists. If you need to distinguish real output from these markers when parsing
a transcript, filter on the fixed banner text and a leading `>>>` yourself;
there is no upstream option that does it for you.

## Namespace lifecycle: three different things, don't conflate them

- **Run File** restarts the interpreter first (`proc python restart
  infile=…`), so a file always starts from an empty namespace and never
  silently depends on state an earlier run left behind. Imports go too, not
  only variables, and every Run File prints the interpreter banner again.
- **Run Selection** (and a cell in the interactive window or a notebook) does
  **not** clear anything first — it builds on whatever earlier runs in the same
  session left in the interpreter, the way a notebook cell builds on the cells
  above it.
- **Reset Python State** (`proc python restart;`) tears down and restarts the
  *interpreter process itself* — imports and variables are gone — but the
  **Compute session** underneath it, and everything that belongs to the
  session rather than the interpreter (SAS librefs, filerefs, macro variables),
  is untouched. It is the same restart Run File does, without running
  anything afterwards — use it to clear state before a Run Selection or a
  notebook cell, which never clear anything themselves.

`PROC PYTHON`'s own `NOTE`s about this — "Resuming Python state from
previous PROC PYTHON invocation.", "Previous Python state destroyed.",
"Python initialized." — never appear in the extension's transcript; they are
filtered as SAS log notes. Don't reason from their absence either way.

## Only one thing runs at a time, and it is refused, not queued

The session executes a run, a reset, or an environment probe one at a time. If
you script or suggest a sequence of extension commands, don't assume a second
one queues behind the first — it is refused outright with a message naming
what's in the way. Wait for the first to finish (or cancel it) before issuing
the next.

**Cancel** stops the local transcript and progress UI immediately, but it
cannot interrupt a Python statement already executing inside SAS — a
`time.sleep(60)` cancelled at six seconds still runs out its full minute
server-side before the interpreter is torn down. Don't promise a user that
cancel is instantaneous on the Viya side.

## Reading and writing SAS library data

The `SAS` bridge object (`PROC PYTHON`'s own, not something this extension
implements) is available in every cell:

```python
df = SAS.sd2df("sashelp.class")          # read a table/view into a DataFrame
SAS.df2sd(df, "work.results")             # write a DataFrame back as a table
SAS.submit("proc sql; ... quit;")         # run arbitrary SAS code in-session
```

This works identically for `WORK`, `SASHELP`, and any site-registered libref,
including one backed by an external database through SAS/ACCESS — from
Python's side they're all just a libref name. `sd2df` reads the whole table
into memory; for a large table or one behind an external engine, push a filter
into SAS first with `SAS.submit("proc sql; create view work.x as select ...")`
and read the view, rather than reading everything and filtering in pandas.

**Never write a credential as a literal anywhere in the submitted Python,
including inside a `SAS.submit()` argument.** The argument you pass to
`SAS.submit()` is echoed into the session log as its own `source`-typed
line — confirmed live (Finding 12.1, `phase-12.md`): a `LIBNAME` statement
with a `password=` value came back in the raw log in full plaintext, with no
masking applied, the moment the statement failed to parse (an invalid libref
name). Don't assume SAS's usual `LIBNAME`-echo masking protects you here —
that same probe found it does not, at least for a statement that fails
before reaching engine-specific handling, so it isn't a safety net worth
relying on. Source a credential from an environment variable or
`SAS.symget` instead of writing it as a literal, or better, use an
already-provisioned site libref that carries no credential in the user's own
code at all. Note this is different from the *outer* Python cell itself,
which the same probe confirmed is never echoed at all (ADR-0014) — the risk
is specific to what you pass into `SAS.submit()`.

## Connecting to CAS from Python

A CAS connection is opened with `swat.CAS(...)`, authenticated by a Viya
access token this extension already holds — never a separate CAS credential.
The token has to reach the interpreter as a **file**, not a literal — the
extension's own **Insert CAS Connection Snippet** command does this correctly
(writes a fresh token to a session file, then reads it back). This isn't
optional caution: an inline `submit`/`endsubmit` block echoes its source
verbatim into the session log, so a token assigned as a literal that way was
confirmed to leak into the log in plaintext (Finding 8.6, `phase-8.md`), and
a `SAS.submit()` argument carrying one is no safer (Finding 12.1, above) —
both had to be treated as compromised when found. If you're writing this by
hand for a user, follow the file-based shape — read the token from a file,
never assign `password="..."` to a string literal in a cell, whether that
literal reaches SAS via an inline block or via `SAS.submit()`.

The token is short-lived (minutes), while a `swat.CAS()` connection can
outlive it; an auth failure after a session's been open a while usually
means the token expired, not a code bug — reconnect with a fresh one rather
than debugging the connection logic.

For a caslib backed by an external database, **Insert CAS SQL Passthrough
Snippet** gives the `conn.fedsql.execDirect(query='''select * from connection
to CASLIB (...)''')` pattern — everything inside `connection to CASLIB(...)`
runs unmodified in the external database; only the result set returns through
CAS, as a `pandas.DataFrame` (a `SASDataFrame`). Note this always runs
single-threaded on the CAS side (`numReadNodes=1`) regardless of cluster
size — that's normal, not something to tune around.

## Figures and tables: `SAS.show()` or a written file

There is no implicit `plt.show()` or `_repr_html_` capture. A figure or a
table reaches the user in one of two ways:

- **`SAS.show(plt, filetype="png")`**, `SAS.show(df)`, or
  `SAS.pyplot(plt, filetype="png")`. The extension opens an ODS HTML5
  destination around every run, so these render in the Result panel and in
  a notebook cell. Pass `filetype="png"` for a figure: the default is SVG,
  which the Result panel shows but a notebook cell replaces with a one-line
  note. Output from a `SAS.submit()` procedure, such as a `proc print`,
  appears the same way.
  Needs Viya 2025.03 or later.
- **Write a file** into the session's working directory:
  `fig.savefig("plot.png")` or `df.to_html("table.html")`. The extension
  diffs that directory after each run and shows new `.png` and `.html`
  files.

Don't call `ods _all_ close;` through `SAS.submit()`: it closes the
extension's destination too, and that run's `SAS.show` output is lost.

## What the environment actually contains

Don't assume Python packages available on Viya match the user's local
environment, and don't assume you can install one. **Show Environment**
reports the interpreter version, executable path, and every installed
distribution (from `importlib.metadata`, not `pip`), probed once per profile
and cached thereafter — a cached answer can be stale relative to a recent
admin change. **Search Environment** is the same data as a filterable quick
pick. **Refresh Environment Info** re-probes. This is **read-only**: there is
no command that installs a package, and suggesting `pip install` as a fix for
a missing Viya-side package is wrong advice — that's the deployment admin's
job. If a local Pylance-reported "unresolved import" conflicts with what Show
Environment says is installed remotely, that's expected (Pylance analyses the
*local* interpreter) and is not itself evidence of a real problem; the
generated stubs this extension writes only silence the false warning; they add
no real completions or type information.

## The command surface

Every command is under the **Python on Viya:** prefix in the Command Palette.
The ones relevant to writing and running code:

- **Select Run Target** — chooses whether the editor's run button targets
  Local Python or a Viya profile; nothing here applies unless the target is a
  Viya profile.
- **Run File** / **Run Selection** — see namespace lifecycle above.
- **New Interactive Window** / **Run Selection in Interactive Window** — a
  persistent, cell-by-cell run history sharing the same namespace-building
  model as Run Selection; not VS Code's own Jupyter-backed interactive window,
  and needs no local kernel.
- **Cancel** — see one-thing-at-a-time above.
- **Reset Python State** — see namespace lifecycle above.
- **Show Environment** / **Search Environment** / **Refresh Environment
  Info** — see environment section above.
- **Insert CAS Connection Snippet** / **Insert CAS SQL Passthrough Snippet** —
  see CAS section above.
- **Open Table** / **Table Properties** / **Export to CSV** (on a SAS Libraries
  or CAS tree item) — browsing, not something Python code calls; only
  meaningful with a specific table already selected in one of those trees, so
  they don't appear in the Command Palette on their own.

## Don't assume upstream `vscode-sas-extension` conventions apply

This extension is a separate project, not a fork or extension of
`sassoftware/vscode-sas-extension`. It runs Python (not SAS) via `PROC
PYTHON`, on Viya 4 only (no Viya 3.5 dialect), and shares no command
namespace, tree, or settings with the upstream SAS extension. Don't carry over
assumptions from that project's SAS-submission model, its settings names, or
its command names.
