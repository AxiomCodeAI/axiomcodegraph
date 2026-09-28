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

module.exports = { Registry, Panel, Mixed, Host };
