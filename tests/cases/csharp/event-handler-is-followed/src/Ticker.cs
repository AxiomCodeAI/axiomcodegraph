using System;

namespace App.Widgets;

public class Ticker
{
    public event EventHandler? Ticked;
    public EventHandler? Tocked;
    public event EventHandler? Silent;
    public void Fire() => Ticked?.Invoke(this, EventArgs.Empty);
    public void FireField() => Tocked?.Invoke(this, EventArgs.Empty);
    public void Raise() => Ticked(this, EventArgs.Empty);
}

public class Listener
{
    public Listener(Ticker t)
    {
        t.Ticked += OnTicked;
        t.Tocked += OnTocked;
        t.Silent += OnSilent;
    }
    private void OnTicked(object? s, EventArgs e) { }
    private void OnTocked(object? s, EventArgs e) { }
    private void OnSilent(object? s, EventArgs e) { }
}
