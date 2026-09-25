package app;

public class Service {
    public int entry() { return helper() + 1; }

    int helper() { return leaf() * 2; }

    int leaf() { return 41; }
}
