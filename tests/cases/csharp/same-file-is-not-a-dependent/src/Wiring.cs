namespace Demo;

public class Builder { }
public class Ctx { }

// two types in one file; neither names the other
public static class Registrar
{
    public static void Wire(Builder b) { }
}

public static class Handler
{
    public static void Apply(Ctx c) { }
}

public static class Keys
{
    public const string Key = "k";
    public static string Read() => Key;
}

public record Note(string Text);
