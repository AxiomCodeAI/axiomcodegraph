from handlers import dispatch


def test_dispatch():
    assert dispatch("order-created", 1) == 1
