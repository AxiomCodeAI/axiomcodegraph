"""Reduction: in a collection literal or a bare tuple, `*` binds to the wrong node.

Mined from CPython 3.10.4 stdlib:
  test/test_call.py:617          args = *args, *kwargs.values()
  test/test_collections.py:1810  {*range(1000)}, {*range(1000)} - {100, 200, 300}
  test/libregrtest/main.py:476   ... *sys.version.split() ...

CPython 3.10.4:  Starred is ALWAYS the outermost node of a starred postfix
                 expression -- Starred(Call(Attribute(Name('k'), 'values')))
tree-sitter 0.21: in a list/set literal and in an unparenthesised tuple the
                 nesting INVERTS --
                   call("*k.values()") > attribute("*k.values") > list_splat("*k")
                 so the callee is `*k.values` and the receiver of `.values()`
                 is `*k` rather than `k`.

Context-dependent, which is what makes it easy to miss:
    f(*k.values())        correct   (argument_list)
    (*k.values(),)        correct   (parenthesised tuple)
    {**k.values()}        correct   (dictionary_splat)
    [*k.values()]         INVERTED  (list literal)
    {*k.values()}         INVERTED  (set literal)
    j = *k.values(),      INVERTED  (bare tuple)

IMPLEMENTATION BUG.  Invisible to a node-COUNT differential -- the counts are
identical and only the parent/child edges move -- so it was found by comparing
node POSITIONS against ast, then confirmed by a parent-relationship scan.
Blast radius: py_expression parent/depth/edge-role, and any receiver-typed
resolution, which sees `*k` as the receiver of `.values()`.
"""


def spread(k, seq):
    correct_in_call = dict(**k.values())
    correct_in_args = list(*seq.values())
    correct_in_paren_tuple = (*seq.values(),)

    inverted_in_list = [*k.values()]
    inverted_in_set = {*k.values()}
    inverted_in_bare_tuple = *k.values(), None

    return (correct_in_call, correct_in_args, correct_in_paren_tuple,
            inverted_in_list, inverted_in_set, inverted_in_bare_tuple)
