from app.session import fetch


def test_fetch():
    assert fetch("u") == b"sent"
