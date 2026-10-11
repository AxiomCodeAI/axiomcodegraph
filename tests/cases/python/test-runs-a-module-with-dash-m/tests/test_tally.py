from pkg.core import tally


def test_tally():
    assert tally([1, 2]) == 2
