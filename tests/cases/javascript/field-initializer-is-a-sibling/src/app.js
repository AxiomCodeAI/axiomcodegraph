function boot() { return 1; }
function tick() { return 2; }
function wrap(f) { return f; }

class Registry {
  static count = boot();
  add(x) { return tick(); }
  remove(x) { return tick(); }
}

class Panel {
  size = boot();
  open() { return tick(); }
  close() { return tick(); }
}

class Mixed {
  static a = boot();
  run() { return tick(); }
  static b = boot();
  stop() { return tick(); }
}

class Host {
  static cb = wrap(() => tick());
  go() { function helper() { return tick(); } return helper(); }
}

function make(o) { return o; }

class ObjLit {
  static cfg = make({ run() { return tick(); } });
  other() { return 1; }
}

class ClsExpr {
  static Inner = wrap(class { m() { return tick(); } });
  other() { return 1; }
}

class PlainObj {
  handlers = { onClick() { return tick(); } };
  other() { return 1; }
}

class InstObj {
  api = make({ fetch() { return tick(); } });
  other() { return 1; }
}

class OneLine { static n = boot(); m() { return tick(); } } function after() { return tick(); }

module.exports = { Registry, Panel, Mixed, Host, ObjLit, ClsExpr, PlainObj, InstObj, OneLine, after };
