import pytest

from app.web import App, Unrelated


@pytest.fixture
def client():
    return App().test_client()


def test_index(client):
    assert client.get("/") == "ok"


def test_unrelated():
    assert Unrelated().open("/") == "/"
