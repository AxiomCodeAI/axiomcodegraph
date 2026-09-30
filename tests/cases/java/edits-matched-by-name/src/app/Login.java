package app;

public class Login {
  private final TokenApi tokens = new Tokens("k");

  public String login(String user) {
    return tokens.issue(user);
  }

  public String whoami(String token) {
    return tokens.subject(token);
  }
}
