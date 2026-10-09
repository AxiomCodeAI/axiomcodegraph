from pkg.m import Box


def test_delete():
    b = Box()
    del b.value
    assert b.value is None
