from app.schema import notify, other_handler


def test_other():
    assert notify("e", other_handler) == "o"
