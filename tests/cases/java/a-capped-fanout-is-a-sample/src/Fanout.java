// 25 implementors of one interface, past the engine's dispatch cap, so the call in `drive` is
// emitted as `fan_capped`: the engine gave up enumerating the candidate set and what is in the
// graph is a SAMPLE of it. That tier used to print as "[resolved] ... calls it" — the strongest
// claim this tool makes, on the one edge that exists because the answer was truncated (#1131).
import java.util.List;
import java.util.ArrayList;

interface Step { void run(); }

public class Fanout {
    static void drive(Step s) { s.run(); }

    public static void main(String[] args) {
        List<Step> steps = new ArrayList<>();
        steps.add(new S1());
        steps.add(new S2());
        steps.add(new S3());
        steps.add(new S4());
        steps.add(new S5());
        steps.add(new S6());
        steps.add(new S7());
        steps.add(new S8());
        steps.add(new S9());
        steps.add(new S10());
        steps.add(new S11());
        steps.add(new S12());
        steps.add(new S13());
        steps.add(new S14());
        steps.add(new S15());
        steps.add(new S16());
        steps.add(new S17());
        steps.add(new S18());
        steps.add(new S19());
        steps.add(new S20());
        steps.add(new S21());
        steps.add(new S22());
        steps.add(new S23());
        steps.add(new S24());
        steps.add(new S25());
        for (Step s : steps) drive(s);
    }
}
class S1 implements Step { public void run() { System.out.println("1"); } }
class S2 implements Step { public void run() { System.out.println("2"); } }
class S3 implements Step { public void run() { System.out.println("3"); } }
class S4 implements Step { public void run() { System.out.println("4"); } }
class S5 implements Step { public void run() { System.out.println("5"); } }
class S6 implements Step { public void run() { System.out.println("6"); } }
class S7 implements Step { public void run() { System.out.println("7"); } }
class S8 implements Step { public void run() { System.out.println("8"); } }
class S9 implements Step { public void run() { System.out.println("9"); } }
class S10 implements Step { public void run() { System.out.println("10"); } }
class S11 implements Step { public void run() { System.out.println("11"); } }
class S12 implements Step { public void run() { System.out.println("12"); } }
class S13 implements Step { public void run() { System.out.println("13"); } }
class S14 implements Step { public void run() { System.out.println("14"); } }
class S15 implements Step { public void run() { System.out.println("15"); } }
class S16 implements Step { public void run() { System.out.println("16"); } }
class S17 implements Step { public void run() { System.out.println("17"); } }
class S18 implements Step { public void run() { System.out.println("18"); } }
class S19 implements Step { public void run() { System.out.println("19"); } }
class S20 implements Step { public void run() { System.out.println("20"); } }
class S21 implements Step { public void run() { System.out.println("21"); } }
class S22 implements Step { public void run() { System.out.println("22"); } }
class S23 implements Step { public void run() { System.out.println("23"); } }
class S24 implements Step { public void run() { System.out.println("24"); } }
class S25 implements Step { public void run() { System.out.println("25"); } }
