package com.test.typeregistry;

public abstract class AbstractBase { }

public final class FinalClass { }

public sealed class SealedClass permits SealedSubclass { }

final class SealedSubclass extends SealedClass { }

public class Outer {
    public static class StaticNested { }
    
    public static abstract class AbstractStaticNested { }
    
    public static final class FinalStaticNested { }
}
