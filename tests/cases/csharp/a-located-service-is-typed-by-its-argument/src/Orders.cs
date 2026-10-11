namespace App.Orders;

public interface IOrderJob { void Run(); }
public class NightlyJob : IOrderJob { public void Run() { } }
public class Worker { public void Start() { } public void Stop() { } }
public class Other { public void Start() { } }
