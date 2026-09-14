package com.test.typeregistry;

public class TopLevel { }

class PackageLevel { }

public class OuterClass {
    public static class StaticNestedClass { }
    
    public class InnerClass { }
    
    public static interface StaticNestedInterface { }
    
    public interface InnerInterface { }
    
    public static class DeeplyNested {
        public static class DeepStaticNested { }
        
        public class DeepInner { }
    }
}
