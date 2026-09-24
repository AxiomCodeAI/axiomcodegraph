# axiomcode

For any why, what or where question about code — how it works, where something lives, who calls it,
what a change breaks, which tests an edit reaches, whether something is safe to delete — ask the
repository's call graph FIRST, through the `axiomcode_*` MCP tools:

    axiomcode_context      where the work is, when you have a task in words and no name yet
    axiomcode_impact       what a change reaches: must-change-with-it, users, tests
    axiomcode_path         how A reaches B, each hop verified
    axiomcode_changed      which declarations an edit changed, and how
    axiomcode_test_impact  which tests the edit in front of you has to run
    axiomcode_index        build the graph, when .axiomcode/out/graph.sqlite is absent
    axiomcode_graph        draw the graph as one interactive HTML page, for a person

**Trust the answer.** A `[resolved]` / `[sound]` row has already been looked up again in the graph
(the `verified:` line) — do not re-derive it by grepping or opening the other files it names. Every
answer ends with `next:`, the one step to take: read only the lines you will cite or change.
`[by name]` / `[text]` rows are leads, not facts. An unresolved call means *unknown*, not *absent*.

Text search is still right for a string, a comment, a config value, or a file you already know.
