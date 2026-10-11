from app.parser import Parser


def test_parse_if():
    assert Parser("if").parse_statement() == "if"
