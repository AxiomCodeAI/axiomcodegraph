from .visitor import NodeVisitor, traced


def emit_name():
    return "name"


def emit_const():
    return "const"


def helper_not_visited():
    return "other"


class CodeGenerator(NodeVisitor):
    def visit_Name(self, node):
        return emit_name()

    @traced
    def visit_Const(self, node):
        return emit_const()

    def visit_Kind0(self, node):
        return 0

    def visit_Kind1(self, node):
        return 1

    def visit_Kind2(self, node):
        return 2

    def visit_Kind3(self, node):
        return 3

    def visit_Kind4(self, node):
        return 4

    def visit_Kind5(self, node):
        return 5

    def visit_Kind6(self, node):
        return 6

    def visit_Kind7(self, node):
        return 7

    def visit_Kind8(self, node):
        return 8

    def visit_Kind9(self, node):
        return 9

    def visit_Kind10(self, node):
        return 10

    def visit_Kind11(self, node):
        return 11

    def visit_Kind12(self, node):
        return 12

    def visit_Kind13(self, node):
        return 13

    def visit_Kind14(self, node):
        return 14

    def visit_Kind15(self, node):
        return 15

    def visit_Kind16(self, node):
        return 16

    def visit_Kind17(self, node):
        return 17

    def visit_Kind18(self, node):
        return 18

    def visit_Kind19(self, node):
        return 19

    def visit_Kind20(self, node):
        return 20

    def visit_Kind21(self, node):
        return 21

    def visit_Kind22(self, node):
        return 22

    def visit_Kind23(self, node):
        return 23

    def leave_Name(self, node):
        return helper_not_visited()
