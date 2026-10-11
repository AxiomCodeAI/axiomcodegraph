from app.client import AppSession


def test_session():
    assert AppSession().fetch("k") == "k"
