# Python and SAS libraries

Your Python code, running on the same Viya session the **SAS Libraries** view
browses, can read and write that session's own SAS library data directly — no
local database driver, and no second credential to manage. This works for
`WORK`, `SASHELP`, and any site-registered library, including one connected to
an external database through SAS/ACCESS (MySQL, Oracle, and so on): from
Python's point of view they are all just a libref.

This is not a feature this extension implements — it is `PROC PYTHON`'s own
`SAS` bridge object, available in every Python cell this extension runs.

## Reading a table

```python
df = SAS.sd2df("sashelp.class")
```

`SAS.sd2df` reads a SAS table (or view) straight into a pandas `DataFrame`.
It reads the whole table into memory — for a large table, filter it down on
the SAS side first (below) rather than reading everything and filtering in
pandas afterward.

## Writing a table

```python
SAS.df2sd(df, "work.results")
```

`SAS.df2sd` writes a `DataFrame` back to a SAS library as a table — `work` for
a session-scoped result, or a writable site-registered library to persist it.

## Filtering before you read: `PROC SQL` pass-through

For a large table, or one behind a SAS/ACCESS engine, push the filter to the
engine instead of pulling the whole table into Python first:

```python
SAS.submit("""
proc sql;
  create view work.recent_orders as
    select * from external_db.orders
    where order_date >= '2026-01-01';
quit;
""")
orders_df = SAS.sd2df("work.recent_orders")
```

`SAS.submit` runs arbitrary SAS code — including `PROC SQL` — in the same
session. This example creates a view with the filter already applied, then
reads only that view.

## Dragging a table from the tree

Dragging a table from the **SAS Libraries** view into a `.py` editor asks how
to bring it in:

- **Read directly** inserts a plain `SAS.sd2df(...)` assignment.
- **Filter with PROC SQL first** inserts the pass-through pattern above, with
  the view name and `where` clause ready to edit.

Either way, the assigned variable name is derived from the table's own name
(`CLASS` → `class_df`), with a numeric suffix if that name is already used
elsewhere in the file.

## Never write a credential as a literal

`SAS.submit()` masks a `password=` value the same way SAS always does when it
echoes a `LIBNAME` statement to the log — but the Python cell itself is
echoed to the job log verbatim, unconditionally, regardless of `SAS.submit()`.
A credential written as a literal string anywhere in the submitted Python —
not just inside a `SAS.submit()` call — leaks through that outer echo before
any masking has a chance to apply. Source a credential from a runtime value
(an environment variable, or a macro variable via `SAS.symget`) instead of
writing it in the cell, and prefer a site-assigned libref (already
provisioned, no credential in your own code at all) over an ad hoc
`SAS.submit("libname ...")` carrying one.
