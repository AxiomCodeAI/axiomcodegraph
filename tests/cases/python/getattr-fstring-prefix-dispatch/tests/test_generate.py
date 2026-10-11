from app.compiler import CodeGenerator
from app.nodes import Name


def test_generate_name():
    assert CodeGenerator().visit(Name()) == "name"
