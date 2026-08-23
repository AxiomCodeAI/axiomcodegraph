import java.util.function.Function;

public class Asset {
    private final Function<String, String> loader;            // field, ctor-assigned lambda
    private Function<String, String> blockLambda;             // field, block-bodied lambda
    private final Function<String, String> initField = p -> readInit(p);   // field initializer
    private final Function<String, String> ref = this::readRef;            // method reference

    Asset() {
        this.loader = p -> read(p);
        this.blockLambda = p -> { audit(p); return readBlock(p); };
    }

    String read(String p)      { return "SINK:" + p; }
    String readBlock(String p) { return "BLOCK:" + p; }
    String readInit(String p)  { return "INIT:" + p; }
    String readRef(String p)   { return "REF:" + p; }
    void   audit(String p)     { }

    private Function<String, String> twoWay;                  // AMBIGUOUS: two different lambdas
    void pickA() { this.twoWay = p -> read(p); }
    void pickB() { this.twoWay = p -> readOther(p); }
    String readOther(String p) { return "OTHER:" + p; }
    String handleTwoWay(String req) { return twoWay.apply(req); }

    String handle(String req)  { return loader.apply(req); }          // through a field
    String handleBlock(String req) { return blockLambda.apply(req); }
    String handleInit(String req)  { return initField.apply(req); }
    String handleRef(String req)   { return ref.apply(req); }
    String handleLocal(String req) {                                   // through a LOCAL
        Function<String, String> f = p -> read(p);
        return f.apply(req);
    }
    public static void main(String[] a) {
        Asset x = new Asset(); x.pickA();
        System.out.println(x.handle("q")+x.handleBlock("q")+x.handleInit("q")+x.handleRef("q")+x.handleLocal("q")+x.handleTwoWay("q"));
    }
}
