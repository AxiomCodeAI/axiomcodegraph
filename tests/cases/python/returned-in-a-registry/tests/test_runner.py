from app.runner import collect


def test_collect():
    assert "now" in collect()
