import pkg as p


def test_chunk():
    assert p.chunk([1, 2, 3], 2) == [[1, 2], [3]]
