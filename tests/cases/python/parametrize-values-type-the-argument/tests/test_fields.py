import pytest

from tests.base import ALL_FIELDS


@pytest.mark.parametrize("FieldClass", ALL_FIELDS)
def test_none(FieldClass):
    field = FieldClass()
    assert field.deserialize(None)
