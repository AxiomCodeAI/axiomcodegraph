from app.report import tally


def test_tally_counts():
    assert tally([1, 2]) == 2
