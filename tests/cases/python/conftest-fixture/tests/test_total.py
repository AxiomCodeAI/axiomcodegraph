from helpers import testing_app


def test_total_is_two():
    assert testing_app() == 2
