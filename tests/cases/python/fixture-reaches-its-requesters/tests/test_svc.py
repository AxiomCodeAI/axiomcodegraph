import pytest


def test_repo(repo):
    assert repo


def test_service(service):
    assert service


def test_client(client):
    assert client


def test_client_by_def_name(client_fixture):
    assert client_fixture


@pytest.mark.parametrize("user", [{"name": "direct"}])
def test_direct(user):
    assert user["name"] == "direct"


@pytest.mark.parametrize("user", ["other"], indirect=True)
def test_indirect(user):
    assert user


def test_plain_user(user):
    assert user["name"] == "default"


def test_widget_here(widget):
    assert widget
