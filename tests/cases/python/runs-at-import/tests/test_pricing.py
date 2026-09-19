from app.pricing import quote


def test_quote():
    assert quote(5).endswith(":5")
