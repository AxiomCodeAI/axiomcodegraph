"""Reduction: a comment or line continuation inside a BASE LIST becomes a base.

Mined from Anaconda 3.12 site-packages:
  tensorflow/python/feature_column/feature_column_v2.py:2602
      class NumericColumn(DenseColumn, fc_old._DenseColumn,
                          # pylint: disable=protected-access
                          collections.namedtuple('NumericColumn', (...))):
  tensorflow/python/training/optimizer.py:222        (3 comment lines before the base)
  tensorflow/python/training/tracking/data_structures.py:455

CPython 3.10.4:   ClassDef(bases=[A, B])                       -- 2 bases
A3 @ 7946eb7:     py_type_base rows A@0, '# a comment'@1, B@2  -- 3 rows,
                  py_type.baseCount = 3

Two distinct damages, and the second is the serious one:

  1. a spurious py_type_base whose `baseText` is comment text, and a
     `baseCount` that the schema calls the "MRO arity sanity check" (col 19)
     now disagrees with the real arity;
  2. the extra row OCCUPIES AN MRO POSITION, so every base after it is shifted:
     B is emitted at position 2 where CPython puts it at 1. The schema's whole
     reason for py_type_base to exist rather than reusing py_type_reference is
     that "Python bases are ordered (C3 depends on it)" -- so a shifted
     position is a silently wrong MRO.

Line continuation does the same: `class C(A, \\` emits a base whose text is
`\\` at position 1.

Third instance of one root cause. f7f3081 fixed grammar extras in ARGUMENT
lists, bdcfa3c fixed them in PARAMETER lists; base lists are the third place
the same walk counts a named `comment` / `line_continuation` node as content.
"""


class A:
    pass


class B:
    pass


class WithComment(A,  # a comment between bases
                  B):
    pass


class WithContinuation(A, \
                       B):
    pass


class Clean(A, B):
    pass
