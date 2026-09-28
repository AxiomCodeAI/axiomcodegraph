def test_order_detail(client):
    assert client.get("/orders/5/").status_code == 200


def test_order_settings(client):
    assert client.get("/orders/settings/").status_code == 302


def test_widgets(client):
    assert client.get("/widgets/").status_code == 200


def test_order_archive(client):
    assert client.get("/orders/archive/").status_code == 404


def test_api_status(client):
    assert client.get("/api/v1/status/").status_code == 200


def test_status_without_prefix(client):
    assert client.get("/status/").status_code == 404
