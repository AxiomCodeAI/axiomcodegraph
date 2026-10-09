from pkg.m import Box


def test_assign():
    b = Box()
    b.value = 4
    assert b.value == 4
