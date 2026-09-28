namespace App;

public interface IStore
{
    void Save(string k);
}

public class SqlStore : IStore
{
    public void Save(string k) { }
}

public interface IShape
{
    double Area();
}

public class Circle : IShape
{
    public double Area() => 3.14;
}

public class Square : IShape
{
    public double Area() => 1.0;
}
