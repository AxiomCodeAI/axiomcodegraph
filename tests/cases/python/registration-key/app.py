from flask import Blueprint

bp = Blueprint("orders", __name__)


@bp.route("/orders/<order_id>/export")
def export_order(order_id):
    return brief(order_id)


@bp.route("/health")
def health():
    return "ok"


def brief(order_id):
    return order_id.upper()
