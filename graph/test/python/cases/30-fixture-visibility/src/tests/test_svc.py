"""The requesters. Each test names one fixture; the comment says which def runs."""


def test_repo(repo):
    """tests/fixtures.py::repo, through the conftest's star import."""
    assert repo


def test_service(service):
    """testsupport/plugin.py::service, through the root conftest's pytest_plugins."""
    assert service


def test_cache(cache):
    """tests/conftest.py::cache, declared in the conftest. The control that always worked."""
    assert cache


def test_client(client):
    """tests/conftest.py::client_fixture, registered as `client`."""
    assert client


def test_client_by_def_name(client_fixture):
    """NOTHING: the fixture is called `client`, and `client_fixture` names no fixture."""
    assert client_fixture


def test_orphan(orphan):
    """NOTHING: tests/unused_fixtures.py is never loaded."""
    assert orphan


def test_hidden(_hidden):
    """NOTHING: a star import does not re-export a leading-underscore name."""
    assert _hidden


def test_widget(widget):
    """NOTHING: `widget` is star-imported into other/conftest.py, a SIBLING directory."""
    assert widget
