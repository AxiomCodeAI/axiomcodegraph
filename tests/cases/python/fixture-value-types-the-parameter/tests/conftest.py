import pytest

from app.core import Ledger, Session


@pytest.fixture
def session():
    s = Session("db")
    yield s
    s.close()


@pytest.fixture
def ledger():
    return Ledger()
