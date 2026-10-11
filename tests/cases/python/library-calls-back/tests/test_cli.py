import pytest
from clikit.testing import CliRunner

from app.cli import AppGroup, greet


@pytest.fixture
def runner():
    return CliRunner()


def test_group(runner):
    cli = AppGroup("app")
    runner.invoke(cli, [])


def test_greet(runner):
    runner.invoke(greet)
