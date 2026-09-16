package pkg;
public class Consumer {
    private Repo repo;
    public String go(String id) { return repo.find(id); }
}
