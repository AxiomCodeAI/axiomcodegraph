import importlib.util
import os
from importlib.machinery import SourceFileLoader

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_loader('graph_core', SourceFileLoader('graph_core', os.path.join(HERE, 'graph-core.py')))
P = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(P)
G, H = P.G, P.H


class Changed:
    def __init__(self, repo):
        self.g = G(repo); self.repo = self.g.repo

    def file_changes(self):
        return self.g.lambda_label(1)


class Impact:
    def __init__(self, g: G):
        self.g = g

    def show(self):
        return self.g.lambda_label(2)


class Rebound:
    def __init__(self, repo):
        self.g = G(repo)

    def swap(self):
        self.g = H()

    def show(self):
        return self.g.lambda_label(3)
