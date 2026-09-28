namespace App.Transit;

// control: the project's own `Hub` and `Migration`. A subclass of either is not the
// framework's, so none of these methods is an entry point.
public class Hub { public void Open() { } }
public class Station : Hub { public void Dock() { } }
public abstract class Migration { public abstract void Up(); }
public class MoveRoute : Migration { public override void Up() { } }
