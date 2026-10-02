# Snippets

The extension ships snippets for the Python you write most often against
SAS Viya: reading and writing SAS tables, macro variables, running SAS code,
showing output, and CAS. They work in `.py` files and in notebook cells.

## Inserting one

Two ways:

- **Type its prefix.** Every prefix starts with `viya-`, so typing `viya`
  lists them all among the editor's suggestions. Pick one with Enter.
- **Run Insert Viya Snippet...**, from the Command Palette or from the
  **Snippets** group of the [Commands view](getting-started.md#the-commands-view).
  It lists only this extension's snippets, with what each one does.

A snippet's highlighted parts are placeholders: type over the first, then
press Tab to move to the next. A placeholder that appears twice, such as a
view's name, changes in both places as you type.

## The snippets

| Prefix                | What it inserts                                                   |
| --------------------- | ----------------------------------------------------------------- |
| `viya-read`           | `SAS.sd2df(...)`: read a SAS table into a DataFrame               |
| `viya-write`          | `SAS.df2sd(...)`: write a DataFrame to a SAS table                |
| `viya-sql-read`       | A `PROC SQL` view that filters on the SAS side, then a read of it |
| `viya-symget`         | Read a macro variable                                             |
| `viya-symput`         | Set a macro variable                                              |
| `viya-submit`         | Run SAS code, and stop if its last step failed                    |
| `viya-show-figure`    | A matplotlib figure shown in the Result panel                     |
| `viya-show-df`        | A DataFrame shown as a table in the Result panel                  |
| `viya-log-warning`    | A `WARNING` line in the SAS log                                   |
| `viya-cas-upload`     | Upload a DataFrame to a CAS table                                 |
| `viya-cas-read`       | Read a CAS table into a DataFrame                                 |
| `viya-libname-secret` | Assign a database library without a password in your code         |

The `SAS` object in these snippets is `PROC PYTHON`'s own bridge, described
in [Python and SAS libraries](data-access.md). A few things about it are
worth knowing when you fill one in:

- **A macro variable is always text.** `SAS.symget` returns a `str`, and
  `""` for a variable that does not exist. `SAS.symput("n", 42)` reads back
  as `"42"`.
- **`SAS.submit` does not tell you whether the SAS code worked.** It returns
  `0` even when a step fails. `viya-submit` reads the automatic macro
  variable `SYSERR`, the last step's return code, and raises unless it is
  `0` (success) or `4` (a warning). That includes `3`, which SAS sets when a
  step only checked its syntax after an earlier error. A failed step also
  makes the whole run report a failure.
- **`SAS.logMessage` needs the `warning` level to be seen.** At its default
  level the message is a SAS note, and the extension does not show notes
  ([ADR-0043](adr/0043-every-run-turns-sas-notes-off.md)). The line reads
  `WARNING: Python-Subprocess - ` and your message.
- **A CAS table from `viya-cas-upload` lasts as long as `conn`'s CAS
  session.** Promote it, or save it to a caslib, to keep it. The two CAS
  snippets need the `conn` that **Insert CAS Connection Snippet** creates
  (see [Connecting to CAS from Python](cas-python-connection.md)).

## A library without a password in your code

`viya-libname-secret` assigns a database library with a password read at
run time, never written in your code:

```python
import os

SAS.symput("dbpass", os.environ["DB_PASSWORD"])
try:
    SAS.submit("""
    libname mydb postgres server="host" user="user" password="%superq(dbpass)" database=db;
    """)
    librc = SAS.symget("SYSLIBRC")
finally:
    SAS.submit("%symdel dbpass;")
if librc != "0":
    raise RuntimeError("LIBNAME failed: SYSLIBRC=" + librc)
```

Replace `os.environ["DB_PASSWORD"]` with wherever the password lives on the
SAS server for you. Three details matter:

- **`%superq(dbpass)`, not `&dbpass`.** SAS echoes the `libname` statement
  into the log. With `%superq` the echo shows `%superq(dbpass)` and never
  the password, even with `options symbolgen`. With `&dbpass`, `symbolgen`
  prints the password.
- **`SYSLIBRC`, not `SYSERR`.** A `libname` that fails leaves `SYSERR` and
  `SYSCC` at `0`, and the run reports success. Only `SYSLIBRC` is set.
- **`%symdel`, in a `finally`,** removes the macro variable once the
  `libname` has run, even if something in between raises, so the password
  never stays in the session.

A library your site has already assigned needs no password from you at
all, and is the better choice where one exists.
