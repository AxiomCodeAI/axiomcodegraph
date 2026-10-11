package pkg;

import java.util.List;
import java.util.Optional;

public class Views {
    public static Response makeResponse(Object req) { return new Response(); }
    public static Optional<Response> maybeResponse(Object req) { return Optional.of(new Response()); }
    public static Builder makeBuilder(Object req) { return new Builder(); }
    public static void untyped(Object req) { }
    public static List<Response> many(Object req) { return List.of(new Response()); }
}
