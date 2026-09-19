def test_export_order(client):
    assert client.get("/orders/o-1/export").status_code == 200
