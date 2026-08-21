"""Reduction: CPython normalises identifiers to NFKC; the tree does not.

Mined from CPython 3.10.4 stdlib test/test_unicode_identifiers.py:6,16.

Python normalises every identifier to NFKC before it becomes a name, so the
MICRO SIGN U+00B5 and GREEK SMALL LETTER MU U+03BC are THE SAME NAME, and the
mathematical-fraktur spelling of "Unicode" is the plain ASCII name.

CPython 3.10.4 symtable binds:   'μ' (U+03BC),  'Unicode'
A3 @ b800789 binds:              'µ' (U+00B5),  '𝔘𝔫𝔦𝔠𝔬𝔡𝔢'

Gate 1 reports this as a simultaneous MISSING + SPURIOUS pair, which is the
worst shape for a bug report: it looks like two unrelated errors rather than
one normalisation gap.  Downstream it is worse -- the two spellings are the
same variable, so a reference resolves to no binding and any join on the name
silently drops the row.
"""


class T:
    µ = 1          # MICRO SIGN; CPython stores this as GREEK SMALL LETTER MU


def use_micro():
    return T.μ     # GREEK SMALL LETTER MU -- the same attribute


def fraktur():
    𝔘𝔫𝔦𝔠𝔬𝔡𝔢 = 2   # normalises to the ASCII name `Unicode`
    return Unicode
