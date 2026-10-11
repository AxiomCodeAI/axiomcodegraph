from pkg.m import Box


def test_read_only():
    assert Box().value == 0
