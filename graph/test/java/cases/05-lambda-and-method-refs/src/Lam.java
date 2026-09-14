import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Lam {
    static class Item {
        void validate(String s) { count++; }
        String name() { return "n"; }
        static int count = 0;
    }
    interface Sink { void accept(Item i); }

    private final Map<String, Item> byName = new HashMap<>();

    void viaForEach(String t) {
        byName.values().forEach(i -> i.validate(t));   // lambda param receiver, lib generic chain
    }

    void viaClientSam(String t) {
        Sink s = i -> i.validate(t);                   // lambda param from a CLIENT SAM
        s.accept(new Item());
    }

    void viaMethodRef(List<Item> l) {
        l.forEach(Lam::validateAll);                  // method ref, static, element arg
    }

    void viaParamList(List<Item> l) {
        l.forEach(i -> i.validate("p"));               // lambda param typed from the RECEIVER's declared type args
    }

    void viaForLoop(List<Item> l) {
        for (Item i : l) i.validate("x");              // enhanced-for variable receiver (control)
    }

    static void validateAll(Item i) { i.validate("s"); }

    public static void main(String[] args) {
        Lam m = new Lam();
        m.byName.put("a", new Item());
        m.viaForEach("t");
        m.viaClientSam("t");
        List<Item> l = new ArrayList<>();
        l.add(new Item());
        m.viaMethodRef(l);
        m.viaParamList(l);
        m.viaForLoop(l);
        System.out.println("count=" + Item.count);
    }
}
