namespace App;

[System.AttributeUsage(System.AttributeTargets.Method)]
public class RouteAttribute : System.Attribute
{
    public RouteAttribute(string path) { Path = path; }
    public string Path { get; }
}
