import pytest

from app.fields import Converter


@pytest.fixture(params=(Converter,))
def converter_cls(request):
    return request.param


@pytest.fixture
def converter(converter_cls):
    return converter_cls(strict=True)
