// A partial type is ONE type declared in N files, and a positional record's
// constructor is declared by its header. Both are shapes where "one row per name" is
// false by construction.
namespace Cases.PartialRecords;

// A POSITIONAL RECORD. Its PRIMARY_CONSTRUCTOR is the only constructor it has, so an
// engine whose constructor set omits that kind reports every `new Point(1, 2)` as
// unresolved -- and records are the normal way to write a C# data type.
public record Point(int X, int Y)
{
    public int Sum() => X + Y;
}

// A PRIMARY CONSTRUCTOR on a class, with a BASE INVOCATION written in the heritage
// clause. `: Point(x, y)` is a constructor call with no call syntax anywhere in the
// body.
public record Point3(int X, int Y, int Z) : Point(X, Y)
{
    public int Volume() => X * Y * Z;
}

public partial class Service
{
    // Declared here, called from the other part.
    private string Helper() => "helped";
}

public partial class Service
{
    // A private member of the OTHER part. Member lookup keyed on the declaration
    // site rather than on the merged type cannot see it.
    public string Run() => Helper();
}

public sealed class Driver
{
    public Point Make() => new Point(1, 2);
    public Point3 Make3() => new Point3(1, 2, 3);
    public int Use() => Make().Sum();
    public string Partial() => new Service().Run();
}
