"""Four ways a fixture reaches this directory's tests, and one way it does not.

  cache          declared here
  repo           star-imported from .fixtures
  client         registered under the name given to the decorator; the def is
                 `client_fixture`, and a test asking for `client_fixture` gets nothing
  user           requested three ways by tests/test_params.py, one of which shadows it
"""
import pytest

from app.svc import make_cache, make_client, make_user

from .fixtures import *


@pytest.fixture
def cache():
    return make_cache()


@pytest.fixture(name="client")
def client_fixture():
    return make_client()


@pytest.fixture
def user():
    return make_user("default")
