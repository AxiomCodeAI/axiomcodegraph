package app;

public interface TokenApi {
  String issue(String user);

  String subject(String token);
}
