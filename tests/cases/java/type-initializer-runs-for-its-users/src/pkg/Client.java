package pkg;

public class Client {
    // an instance field initializer runs in every constructor of Client
    private final Cache cache = Cache.create();

    public String read() { return cache.get(); }
}
