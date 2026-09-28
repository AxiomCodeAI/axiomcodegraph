import pytest

from shop.svc import class_account, module_account


@pytest.fixture
def account():
    return module_account()


class TestOverride:
    @pytest.fixture
    def account(self):
        return class_account()

    def test_in_class(self, account):
        assert account == "class"


class TestPlain:
    def test_no_override(self, account):
        assert account == "module"


def test_module_level(account):
    assert account == "module"
