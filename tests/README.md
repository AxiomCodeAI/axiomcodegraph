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
                                         never raises, silent without a graph, once per session across
                                         repositories, and names the verb for a declared name it is searched for)
    python3 tests/hook_languages.py      the edit hooks speak for C# as for Java and Python, from one extension table,
                                         and a body edit's command runs the classes that extend an abstract test base
                                         (indexes a small C# project, so it needs the engine)
    python3 tests/refresh.py             the graph refreshes itself after an edit in every language: a query sees the
                                         edit, `changed` answers the same before and after, a burst costs one rebuild
                                         and queries during it answer (#1305; builds real graphs, needs the engine)
    python3 tests/graph_verb.py          `axiomcode graph` draws the existing graph and rebuilds a stale one with the flags it
                                         was indexed with; no rebuild path (refresh, repair, bare index) solves a language an
                                         explicit --lang left out (builds real graphs, needs the engine)
    python3 tests/indexed_tree.py        changed compares against the tree the graph was indexed from, so an
                                         index taken with uncommitted edits reports only later edits (#1222)
    python3 tests/mcp.py                 `axiomcode mcp` answers initialize, lists every tool and runs one,
                                         directly, through an npm-style symlink to bin/axiomcode.js, on the SDK-free
                                         fallback, and from .mcp.json, .codex-plugin/mcp.json and .cursor-plugin
                                         as each host starts it
    python3 tests/manifests.py           every agent's manifest (Claude, Codex, Cursor, Gemini) names the same
                                         plugin and points at files that exist, the way that agent resolves
                                         them, and Gemini's skill and Cursor's rule are current copies
    python3 tests/mcp_first.py           the description, the install block and the orient and directive hooks name the
                                         MCP tool before the shell verb, and still carry the shell verb for a host
                                         without the server (#1425; indexes one case, so it needs the engine)
    python3 tests/hosts.py               each hook tells Cursor and Gemini CLI what it tells the original host,
                                         in their own event names and output shape (indexes one case, so it needs the engine)
    python3 tests/enrich_budget.py       what a Read or a Grep adds to a session is capped: a declaration annotated once,
                                         the budget said spent once, its second half kept for edges into unopened files
                                         (#1199; indexes a small project, so it needs the engine)
    python3 tests/enrich_lines.py        what one enrichment line says: a caller count of 0 says why (entry point, by-name
                                         sites, a framework annotation), production callers before tests, a base before its
                                         overrides, no annotation for a shell grep over output or logs, nothing for an edit
                                         that changes no declaration, one line of tests for a body edit (#1507, #1546, #1604;
                                         indexes a small project, so it needs the engine)
    python3 tests/engine_choice.py       axiomcode-build picks a built engine over an unbuilt clone it sits in, finds the
                                         engine the last build used before PATH (the refresh runs from a hook, with the
                                         hook's PATH), follows a Windows npm shim, and names every place it looked when
                                         it finds none
    python3 tests/freshness.py           an answer from a graph older than an edit marks the rows in edited files (text and
                                         --json) and nothing else; it waits only when the answer touches an edited file
                                         and the refresh is expected within the budget, never on a rules compile;
                                         --fresh waits and MCP takes fresh=true; the file table prunes exactly what each
                                         parser skips, so an edit under out/ or build/ is seen (#1594, #1595; no engine)
    python3 tests/refresh_races.py       what a refresh after an edit can leave behind, each with a control: a broken
                                         graph pointer is repaired and keeps the baseline; a query mid-build waits for it
                                         and starts no build; a failed build never leaves the pointer dangling; a failed
                                         refresh says why; git-ignored directories are neither parsed nor watched; with
                                         no rules and no soufflé impact answers from SQL (builds real graphs, needs the engine)
    python3 tests/no_symlink.py          impact and the Datalog path answer where os.symlink is refused, as it is for an
                                         unelevated Windows user (WinError 1314); indexes a case, so it needs the engine
    python3 tests/multi_language.py      a repository in several languages is indexed in all of them and every query asks
                                         each graph: nothing dropped, a one-graph answer unchanged, an edit reported once,
                                         refreshed, upgraded from a one-language graph (builds real graphs, needs the engine)
    python3 tests/latency.py             what a query repeats on every call is done once, with the same answer: the non-source
                                         scan cached per graph, a repeated impact solve read back, one tree walk for every language,
                                         the verb and the Python found without starting programs, a first build that reports its
                                         stage instead of holding the call (indexes a small project, so it needs the engine;
                                         --no-engine for the rest)
    python3 tests/facts_cache.py         path and impact do not answer from edges an older plugin exported: the export's
                                         stamp carries a version, so an upgrade re-exports (#1402; indexes a case)
    python3 tests/publish_order.py       a repository in several languages is queryable when its main language is solved, not
                                         when the last one is: the others are held back, a query answers and names what it
                                         cannot see, a first query does not wait for them, one language alone is unchanged
                                         (#1555; builds real graphs, needs the engine)
    python3 tests/query_rules.py         the query rules compile once per machine, never while a query waits: a first query
                                         answers from the interpreter and starts one background compile into the user
                                         cache, a second plugin copy reuses it, rules one line apart do not, an older
                                         plugin's dl/.cache binary is still used (#1606; needs soufflé and c++, no engine)
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
