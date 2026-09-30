package app;

public class Tokens implements TokenApi {
  private final String key;

  public Tokens(String key) {
    this.key = key;
  }

  @Override
  public String issue(long userId) {
    return key + ":" + userId;
  }

  @Override
  public String subject(String token) {
    return token.substring(token.indexOf(':') + 1);
  }

  private long expiry() {
    return 3600L;
  }
}
