package pkg;

public class Shared {
    // reached only through a @BeforeEach method, which JUnit runs before every test of its class
    public static void prepare() { }

    // reached only through an @AfterEach method, which JUnit runs after every test of its class
    public static void clean() { }

    // reached only through a JUnit 3 tearDown
    public static void close() { }

    // reached only through a JUnit 3 setUp
    public static void boot() { }
}
