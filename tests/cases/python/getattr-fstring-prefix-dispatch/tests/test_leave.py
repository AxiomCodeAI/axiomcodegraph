from app.compiler import CodeGenerator
from app.nodes import Name


def test_leave():
    assert CodeGenerator().leave_Name(Name()) == "other"
