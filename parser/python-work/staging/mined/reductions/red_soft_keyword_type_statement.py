"""Reduction: statement-initial `type(...)` is parsed as a PEP 695 type alias.

Mined from CPython 3.10.4 stdlib:
  test/test_contextlib.py:731        type(self).saved_details = exc_details
  unittest/mock.py:125,126           type(mock)._mock_check_sig = checksig
  test/test_urllib.py:94             type(self).fakesock = self.sock
  unittest/test/testmock/testhelpers.py:1083
  unittest/test/testmock/testmagicmethods.py:363
  unittest/test/testmock/testmock.py:1457

CPython 3.10.4:  Assign(targets=[Attribute(value=Call(func=Name('type')))])
tree-sitter 0.21: type_alias_statement(left=type, right=type) -- the Call node
                  does not exist in the tree at all, and rootNode.hasError is
                  FALSE, so nothing flags it.

Blast radius: the `type(x)` call site disappears (py_call_site), the assignment
target disappears (py_binding for an attribute store), and py_expression gets a
node type that cannot occur in 3.10 source.
"""


class C:
    saved = None


def store(self, value):
    type(self).saved = value          # <-- misparsed
    type(self)[0] = value             # <-- misparsed
    return type(self).saved           # <-- parsed correctly (not statement-initial)


type_alias_lookalike = 1
