"""Reduction: backticks that a raw-source Python-2 scan must NOT reject.

Corpus measurement: 7,324 of 21,323 CPython-3.10.4-valid files contain a
backtick, and in ZERO of them does a backtick fall outside a STRING or COMMENT
token (ground truth: CPython's own `tokenize`).  Backticks are reST/Markdown
markup in docstrings, not Python 2 repr.

A3's Tier-3 rejection scans raw source for backticks while tracking string and
comment state, because the backtick is indistinguishable from a string in the
tree.  That state machine has a 34%-of-corpus blast radius if it slips, and
nothing in the staged fixtures exercises it.  Every construct below is valid
3.10 and must survive.
"""

CHAR = "`"
ESCAPED_QUOTE_THEN_TICK = 'it\'s a `tick`'
DOUBLE_IN_SINGLE = 'he said "hi" and `tick`'
RAW = r"a raw \` backtick"
RAW_BYTES = rb"\`"
TRIPLE_WITH_INNER_QUOTES = """
    A docstring with 'single', "double" and ``double backticks``.
    It even contains an unbalanced ' quote and a # hash.
"""
NESTED_TRIPLE = '''
    Contains """ inside, plus a `tick`.
'''
CONTINUED = "a backtick \
` after a line continuation"
FSTRING = f"{CHAR} and `literal` and {'`' if CHAR else ''}"
CONCATENATED = "first `" "second `"

x = 1  # a trailing comment with a ` backtick and a ' quote


def documented():
    """Use ``obj.method()`` and `single ticks`.

    A hash # inside a docstring, and a quote ' too.
    """
    return CHAR


class Documented:
    '''Class docstring with `ticks` and a "quote".'''

    attr = "`"
