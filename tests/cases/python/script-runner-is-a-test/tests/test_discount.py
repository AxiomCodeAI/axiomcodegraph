from app.pricing import discount


def test_discount():
    assert discount(10) == 10.8
