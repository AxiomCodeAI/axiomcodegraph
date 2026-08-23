// SHAPE 3 of the open d1 recall gap: the callback's receiver is a LAMBDA PARAMETER, so its type
// comes from the target functional interface's type argument. Three variants of increasing
// difficulty, so progress is measurable per variant.
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class LambdaParamCallback {

    static class Item {
        void validate(String s) { }
        String name() { return "n"; }
    }

    private final Map<String, Item> byName = new HashMap<>();

    // (a) receiver's OWN type arguments are written at the call site: List<Item>
    void viaTypedList(List<Item> items, String t) { items.forEach(i -> i.validate(t)); }

    // (b) the element type comes through a LIBRARY GENERIC CHAIN: Map<String,Item>.values()
    //     returns Collection<V>, so V must be substituted from the field's declared type args.
    void viaMapValues(String t) { byName.values().forEach(i -> i.validate(t)); }

    // (c) two hops of library generics: stream() then forEach
    void viaStream(List<Item> items, String t) { items.stream().forEach(i -> i.validate(t)); }

    public static void main(String[] a) {
        LambdaParamCallback c = new LambdaParamCallback();
        List<Item> l = new ArrayList<>(); l.add(new Item());
        c.byName.put("k", new Item());
        c.viaTypedList(l, "t"); c.viaMapValues("t"); c.viaStream(l, "t");
    }
}
