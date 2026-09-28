import pytest

from app.svc import make_widget


@pytest.fixture
def widget():
    return make_widget()
