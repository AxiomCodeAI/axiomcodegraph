package app;
public class GitRepo implements Repo {
  public String find(String name) { fetch(); return name; }
  public void fetch() { }
}
