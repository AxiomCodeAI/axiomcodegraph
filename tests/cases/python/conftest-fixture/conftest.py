import pytest

from lib import make_widget, reset


@pytest.fixture
def widget():
    return make_widget()


@pytest.fixture(autouse=True)
def reset_state():
    return reset()
