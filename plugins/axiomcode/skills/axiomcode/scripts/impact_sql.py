"""impact_sql.py — the impact rules as SQL over graph.sqlite, in place of the Soufflé round trip.

`axiomcode-impact` currently exports 45 input relations to .facts files (401 MB on a 1.23M-LOC Java bundle),
starts Soufflé, and reads 16 output relations back. Measured on that bundle, a warm query with --depth 1 still
costs 21 s, and --depth 12 costs 26 s — so the transitive closure is only ~5 s and **the other 21 s is the round
trip**: materialising the facts and loading them again. The rules themselves are cheap; the plumbing is not.

The exporter already derives every input relation from graph.sqlite in SQL. This module keeps that derivation and
drops the round trip: the inputs become temp tables in the same connection, the rules become SELECTs over them,
and the recursive ones (reach, parent_up) become recursive CTEs driven by index.

It produces exactly the dict `Impact.solve()` returns — the 16 relations keyed by name, each a list of rows with
the query id appended — so the 1,152-line formatter and the `verified:` check are untouched and cannot drift.

Status: a relation is ported only once `validate/impact_sql_parity.py` shows it matching Soufflé row-for-row on
sampled targets. PORTED lists what has cleared that bar; everything else still goes to Soufflé, so the command is
correct at every point during the migration.
"""
import os, sqlite3

PORTED = set()          # relations answered from SQL; the rest fall through to Soufflé

def available(repo):
    db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
    return os.path.exists(db)
