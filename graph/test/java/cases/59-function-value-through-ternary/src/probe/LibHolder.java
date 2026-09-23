package probe;

import dep.Fn;

class LibHolder {
    private Fn<String, String> fn = App::viaInit;
    void strict() { this.fn = (App::getPath); }
    String run(String url) { return fn.call(url); }
    Fn<String, String> wrap() { return fn.logged(); }   // a default method: not a base
}
