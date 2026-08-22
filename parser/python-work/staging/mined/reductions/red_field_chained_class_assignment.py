"""Reduction: a chained class-body assignment records only its FIRST target.

Mined from CPython 3.10.4, where the idiom is common:
  distutils/unixccompiler.py:80
      static_lib_format = shared_lib_format = dylib_lib_format = "lib%s%s"
  email/_header_value_parser.py:491
      local_part = domain = route = addr_spec = display_name
  collections/__init__.py:215
      update = __update = _collections_abc.MutableMapping.update
  distutils/msvccompiler.py, bcppcompiler.py, msvc9compiler.py — same shape

CPython 3.10.4:  Assign(targets=[Name(a), Name(b), Name(c)]) — three class
                 attributes, all three real at runtime.
A3 @ 05bf1da:    one py_field row, for `a` only.

The `self.` form is handled correctly — `self.p = self.q = 3` yields both — so
the gap is specific to the class body.

Measured cost: 7 of the 400-file stdlib slice's missing fields are this one
pattern, and it is the ONLY py_field coverage defect in that slice (0 spurious,
0 other missing, after the oracle was corrected for name mangling, nested
unpacking targets, conditional class bodies and nested classes).
"""


class ChainedClassBody:
    a = b = c = 1                       # three fields; only `a` is emitted
    single = 2                          # emitted


class ChainedSelfAssign:
    def __init__(self):
        self.p = self.q = 3             # both emitted — this form is correct


class ShadowsAProperty:
    """The email/_header_value_parser.py shape: a chained assignment whose
    value is a property defined above it."""

    @property
    def display_name(self):
        return None

    local_part = domain = route = addr_spec = display_name
