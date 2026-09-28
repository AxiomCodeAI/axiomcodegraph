"""A fixture a class declares serves that class and its subclasses, and overrides the module's."""
import pytest

from app.svc import class_account, module_account


@pytest.fixture
def account():
    return module_account()


class TestOverride:
    @pytest.fixture
    def account(self):
        return class_account()

    def test_in_class(self, account):
        """TestOverride.account only: the class fixture shadows the module one."""
        assert account == "class"


class TestOverrideChild(TestOverride):
    def test_in_subclass(self, account):
        """TestOverride.account, inherited."""
        assert account == "class"


class TestPlain:
    def test_no_override(self, account):
        """the module fixture: a SIBLING class's fixture is not visible here."""
        assert account == "module"


def test_module_level(account):
    """the module fixture."""
    assert account == "module"
