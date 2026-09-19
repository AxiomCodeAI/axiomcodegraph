from app import export


def test_export_csv():
    assert export(["a", "b"], "csv") == "a,b"
