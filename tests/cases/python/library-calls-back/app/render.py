from tmpl import BaseLoader, Environment


class AppLoader(BaseLoader):
    def get_source(self, env, name):
        return name


class OtherLoader:
    def get_source(self, env, name):
        return name


def make_env(opts):
    return Environment(**opts)


def render(opts):
    env = make_env(opts)
    return env.get_template("index")
