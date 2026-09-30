import pytest

from shop.svc import local_server, make_admin, make_audit, make_guest, remote_server


@pytest.fixture
def admin_user():
    return make_admin()


@pytest.fixture
def guest_user():
    return make_guest()


@pytest.fixture
def local_srv():
    return local_server()


@pytest.fixture
def remote_srv():
    return remote_server()


@pytest.fixture
def audit_log():
    return make_audit()


@pytest.fixture
def staging_srv():
    return "https://staging.test"


@pytest.fixture
def mirror_srv():
    return "https://mirror.test"


@pytest.fixture
def backup_srv():
    return "https://backup.test"
