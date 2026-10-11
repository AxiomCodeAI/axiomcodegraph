package pkg;
public class OrderService {
    private final Repo repo;
    public OrderService(Repo repo) {
        this.repo = repo;
    }
    public String load(String id) { return repo.find(id); }
    public long total() { return 42; }
    public int count() {
        return 7;
    }
}
