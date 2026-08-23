package core;

import util.Strings;

public class Engine {
    private final Handler handler = new FastHandler();   // impl in a sibling file, same package
    public String run(String s) {
        String t = Strings.trim(s);      // cross-package, single-type import
        return handler.handle(t);        // interface in a sibling file -> CHA to FastHandler
    }
}
