package app;
// calls GitRepo.fetch on a GitRepo: certain
public class Service {
  private final GitRepo git = new GitRepo();
  public void sync() { git.fetch(); }
}
