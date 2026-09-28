"""A fixture module that NOTHING imports and no conftest names.

`orphan` is declared with the fixture decorator and a test requests a parameter called
`orphan`, but the runner never loads this module, so the request fails. The name alone
is not visibility.
"""
import pytest

from app.svc import make_orphan


@pytest.fixture
def orphan():
    return make_orphan()
