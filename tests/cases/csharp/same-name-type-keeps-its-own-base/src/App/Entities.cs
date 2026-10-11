namespace App.Entities;

// an entity: no base, nothing registers it
public class Basket
{
    public int Count;
    public void SetQuantities(int n) { Count = n; }
    public void Clear() { Count = 0; }
}

// a single class of its name
public class Wishlist
{
    public void Add(string item) { }
    public void Clear() { }
}
