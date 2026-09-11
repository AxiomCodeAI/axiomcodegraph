package app;

/**
 * Implementations of a LIBRARY-declared supertype. Nothing in this project constructs them:
 * that is the whole point of the case (see Dispatch). A container or a registry supplies them.
 */
class ExtImplA implements dep.Strategy { public String run() { return markA(); } static String markA() { return "a"; } }
class ExtImplB implements dep.Strategy { public String run() { return markB(); } static String markB() { return "b"; } }

class ExtSubA extends dep.Task { public String run() { return markA(); } static String markA() { return "a"; } }
class ExtSubB extends dep.Task { public String run() { return markB(); } static String markB() { return "b"; } }
