import pytest


@pytest.mark.usefixtures("server")
class TestWithServer:
    def test_uses_server(self):
        assert True


class TestWithoutServer:
    def test_no_server(self):
        assert True
