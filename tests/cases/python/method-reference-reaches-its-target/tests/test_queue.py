from unittest import mock

from orders import OrderService, executor_svc


def test_queues_the_cancel():
    loop = mock.Mock()
    executor_svc(loop, OrderService(), "o-1")
    loop.run_in_executor.assert_called_once()
