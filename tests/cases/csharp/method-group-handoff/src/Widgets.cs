using System;
using System.Threading;

namespace App.Widgets;

public class WidgetSweeper
{
    private Timer? _timer;
    public void Start()
    {
        _timer = new Timer(Sweep, null, 0, 1000);
        AppDomain.CurrentDomain.ProcessExit += OnExit;
        Run(Report);
        Run(() => Lambda());
        Run(flag ? Report : Fallback);
    }
    private bool flag;
    private void Sweep(object? state) { }
    private void OnExit(object? s, EventArgs e) { }
    private void Report() { }
    private void Fallback() { }
    private void Lambda() { }
    private void Unused() { }
    private static void Run(Action a) => a();
}
