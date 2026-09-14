package app;

/** The CLIENT-declared twins of the two supertypes above, structurally identical. They are the
 *  control: whatever the engine answers for them is what it must answer across the boundary. */
interface LocalStrategy { String run(); }
abstract class LocalTask { public abstract String run(); }

class LocImplA implements LocalStrategy { public String run() { return markA(); } static String markA() { return "a"; } }
class LocImplB implements LocalStrategy { public String run() { return markB(); } static String markB() { return "b"; } }

class LocSubA extends LocalTask { public String run() { return markA(); } static String markA() { return "a"; } }
class LocSubB extends LocalTask { public String run() { return markB(); } static String markB() { return "b"; } }
