package pkg;

public class Unrelated {
    // called directly by HelperTest.other
    public static void ping() { }

    // reached only through HelperTest.unused, a helper no test calls
    public static void pong() { }

    // reached only through a lambda written inside HelperTest.viaLambda
    public static int lazy() { return 1; }

    // reached only through an anonymous class written inside HelperTest.viaAnonymous
    public static void later() { }
}
