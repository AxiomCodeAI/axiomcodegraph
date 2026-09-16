# tests

What the plugin claims to find, checked on code small enough to read in full. No corpus, no network, nothing
outside the case directory: every case is a synthetic project written for one behaviour, and every check names
the behaviour it is about, so a failure says what broke rather than which number moved.

    python3 tests/run.py                 every case
    python3 tests/run.py --lang java     one language
    python3 tests/run.py qualified-this-unrelated -v
    python3 tests/run.py --keep          leave the built graph in the case directory to inspect

A case is `tests/cases/<language>/<name>/` with its sources and a `case.json`:

    {"lang": "java", "src": "src",
     "checks": [{"why":   "a this.field write in an unrelated class is not this field",
                 "run":   ["impact", "A.url", "--kind", "field"],
                 "want":  ["reads it through url()"],
                 "avoid": ["B.B", "B.url"]}]}

`run` is the subcommand and its arguments; the repository is appended. `want` and `avoid` are substrings of the
output. The case is indexed once and its `.axiomcode` removed afterwards.

Adding one: write the smallest program that shows the behaviour, name the directory after the behaviour rather
than after an issue number, and write `why` as the claim being checked. A case that reproduces a defect should
fail before the fix and pass after it, and the `avoid` list is what keeps it honest: it is the wrong answer the
tool used to give.
