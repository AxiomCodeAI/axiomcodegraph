package app;
// reaches GitRepo.fetch only if the Repo it holds is a GitRepo: a dispatch choice, not a certainty
public class Controller {
  private final Repo repo;
  public Controller(Repo repo) { this.repo = repo; }
  public String get(String name) { return repo.find(name); }
}
