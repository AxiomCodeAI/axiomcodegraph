import pytest

from shop.svc import load_config, load_image, make_clean_dir, make_client, make_user, start_server

from .fixtures import *


@pytest.fixture(name="client")
def client_fixture():
    return make_client()


@pytest.fixture
def user():
    return make_user("default")


@pytest.fixture
def server():
    return start_server()


@pytest.fixture
def test_image():
    return load_image()


@pytest.fixture
def cleandir():
    return make_clean_dir()


@pytest.fixture
def config_loaded():
    return load_config()
