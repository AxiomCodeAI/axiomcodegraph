// Function values reaching a call site through a PARAMETER or a COLLECTION. Fields and locals are
// tracked; these two are not, and the point of this case is to pin exactly which variants resolve
// today so a change in either direction is visible. The dispatch-table idiom (c) is the common
// real-world shape, so its status matters.
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

public class FunctionValues {

    String impl(String s)  { return "impl:" + s; }
    String other(String s) { return "other:" + s; }

    // (a) the function value arrives as a PARAMETER, with the lambda visible at the call site
    String viaParameter(Function<String, String> f, String s) { return f.apply(s); }
    String callsViaParameter(String s) { return viaParameter(x -> impl(x), s); }

    // (b) the function value arrives as a parameter from ANOTHER method (one hop of flow)
    String indirect(String s) { return viaParameter(x -> other(x), s); }

    // (c) DISPATCH TABLE: lambdas stored in a Map, retrieved by key
    private final Map<String, Function<String, String>> handlers = new HashMap<>();
    void register() {
        handlers.put("a", x -> impl(x));
        handlers.put("b", x -> other(x));
    }
    String viaMap(String key, String s) { return handlers.get(key).apply(s); }

    // (d) lambdas in a LIST, invoked by iteration
    private final List<Function<String, String>> chain = new ArrayList<>();
    void build() { chain.add(x -> impl(x)); }
    String viaList(String s) {
        String out = s;
        for (Function<String, String> f : chain) out = f.apply(out);
        return out;
    }

    public static void main(String[] a) {
        FunctionValues v = new FunctionValues();
        v.register(); v.build();
        System.out.println(v.callsViaParameter("p") + v.indirect("q")
                         + v.viaMap("a", "r") + v.viaList("s"));
    }
}
