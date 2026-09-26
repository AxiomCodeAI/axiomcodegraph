# tests

What the plugin claims to find, checked on code small enough to read in full. No corpus, no network, nothing
outside the case directory: every case is a synthetic project written for one behaviour, and every check names
the behaviour it is about, so a failure says what broke rather than which number moved.

    python3 tests/run.py                 every case
    python3 tests/run.py --lang java     one language
    python3 tests/run.py qualified-this-unrelated -v
    python3 tests/run.py --keep          leave the built graph in the case directory to inspect

One check needs no graph and is its own script:

    python3 tests/surfaces.py            every dispatched verb is documented on --help, SKILL.md and MCP
    python3 tests/fastpath.py            the hooks' SQL fast path agrees with the rules, shape by shape
    python3 tests/directive.py           the PreToolUse directive hook keeps its promises (never blocks,
                                         never raises, silent without a graph)
    python3 tests/refresh.py             the graph refreshes itself after an edit in every language: a query sees the
                                         edit, `changed` answers the same before and after, a burst costs one rebuild
                                         and queries during it answer (#1305; builds real graphs, needs the engine)
    python3 tests/indexed_tree.py        changed compares against the tree the graph was indexed from, so an
                                         index taken with uncommitted edits reports only later edits (#1222)
    python3 tests/mcp.py                 `axiomcode mcp` answers initialize, lists every tool and runs one,
                                         directly, through an npm-style symlink to bin/axiomcode.js, on the SDK-free
                                         fallback, and from .mcp.json, .codex-plugin/mcp.json and .cursor-plugin
                                         as each host starts it
    python3 tests/manifests.py           every agent's manifest (Claude, Codex, Cursor, Gemini) names the same
                                         plugin and points at files that exist, the way that agent resolves
                                         them, and Gemini's skill and Cursor's rule are current copies
    python3 tests/hosts.py               each hook tells Cursor and Gemini CLI what it tells the original host,
                                         in their own event names and output shape (indexes one case, so it needs the engine)
    python3 tests/enrich_budget.py       what a Read or a Grep adds to a session is capped: a declaration annotated once,
                                         the budget said spent once, its second half kept for edges into unopened files
                                         (#1199; indexes a small project, so it needs the engine)
    python3 tests/engine_choice.py       axiomcode-build picks a built engine over an unbuilt clone it sits in
    python3 tests/no_symlink.py          impact and the Datalog path answer where os.symlink is refused, as it is for an
                                         unelevated Windows user (WinError 1314); indexes a case, so it needs the engine
    python3 tests/tiers.py               every call_edges tier the schema documents is ranked, labelled and given a
                                         certainty by the frontend, so a new tier cannot read as the weakest claim

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
