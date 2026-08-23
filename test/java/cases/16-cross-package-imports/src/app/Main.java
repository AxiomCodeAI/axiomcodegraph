package app;

import core.Engine;                       // single-type import
import core.Config;                       // COLLIDES by simple name with util.Config
import static util.Strings.shout;         // static import
import util.*;                            // wildcard import (brings util.Strings)

// CROSS-PACKAGE resolution. Five distinct mechanisms, so a partial failure is visible:
//   (1) single-type import      -> Engine
//   (2) wildcard import         -> Strings
//   (3) static import           -> shout(..) with no qualifier
//   (4) inline fully-qualified  -> util.Strings.pad(..)
//   (5) SIMPLE-NAME COLLISION   -> Config here must be core.Config, NOT util.Config
public class Main {

    public static void main(String[] args) {
        Engine e = new Engine();                     // (1)
        System.out.println(e.run("x"));
        System.out.println(Strings.trim("  y  "));   // (2) via wildcard
        System.out.println(shout("z"));              // (3) static import, unqualified
        System.out.println(util.Strings.pad("w"));   // (4) inline FQN
        System.out.println(Config.load());           // (5) must bind core.Config.load
    }
}
