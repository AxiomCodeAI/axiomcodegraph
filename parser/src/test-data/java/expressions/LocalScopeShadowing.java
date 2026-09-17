package com.example.expressions;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * A local shadows a field only WHERE IT IS IN SCOPE (JLS 6.3), which is from its own declarator to
 * the end of the scope that declares it. Classifying a use by "is this name declared anywhere in
 * this method" loses the field read above the declaration, and the one after a sibling block closed.
 *
 * Every expectation here is javac's: renaming the field makes exactly the lines marked FIELD fail
 * to compile, and no other line.
 */
public class LocalScopeShadowing {

    private Object value;
    private int count;
    private String reader;
    private int index;
    private String item;
    private String error;
    private String shape;

    /** The reported defect: the field is read above a later local of the same name. */
    public int laterLocal() {
        if (value == null) {            // FIELD: no local `value` is in scope yet
            return 31;
        }
        long value = 7L;                // the local starts here
        return (int) value;             // LOCAL_VARIABLE
    }

    /** A local dies with the block that declared it, so a sibling block cannot see it. */
    public int closedSiblingBlock() {
        {
            int count = 5;              // LOCAL_VARIABLE, scoped to this block
            System.out.println(count);  // LOCAL_VARIABLE
        }
        return count + 1;               // FIELD: that local closed with its block
    }

    /** A `for` header declares into the statement, not into the rest of the method. */
    public int forHeader() {
        int total = 0;
        for (int index = 0; index < 3; index++) {
            total += index;             // LOCAL_VARIABLE
        }
        return total + index;           // FIELD: the loop variable is gone
    }

    /** An enhanced-for variable is scoped to its own statement too. */
    public String eachHeader(List<String> items) {
        for (String item : items) {
            if (item.isEmpty()) {       // LOCAL_VARIABLE
                return item;            // LOCAL_VARIABLE
            }
        }
        return item;                    // FIELD
    }

    /** A catch parameter is scoped to its clause. */
    public String catchParameter() {
        try {
            throw new IllegalStateException("x");
        } catch (RuntimeException error) {
            return error.getMessage();  // LOCAL_VARIABLE (javac: EXCEPTION_PARAMETER)
        } finally {
            System.out.println(error);  // FIELD: the catch parameter is not in scope here
        }
    }

    /** A try-with-resources header is scoped to the resource list and the try body. */
    public String resourceHeader() throws IOException {
        try (BufferedReader reader = new BufferedReader(new StringReader("x"))) {
            return reader.readLine();   // LOCAL_VARIABLE (javac: RESOURCE_VARIABLE)
        } finally {
            System.out.println(reader); // FIELD: the resource is out of scope
        }
    }

    /** A pattern variable binds where the pattern matched, and the field is read before it. */
    public String patternVariable(Object o) {
        System.out.println(shape);      // FIELD
        if (o instanceof String shape) {
            return shape;               // the binding
        }
        return "";
    }

    /** A local declared inside a lambda body is not in scope outside it. */
    public Supplier<Integer> lambdaBody() {
        Supplier<Integer> s = () -> {
            int count = 2;              // LOCAL_VARIABLE, scoped to the lambda body
            return count;               // LOCAL_VARIABLE
        };
        System.out.println(count);      // FIELD
        return s;
    }

    /** CONTROL: a field read with no local of that name anywhere in the method. */
    public int plain() {
        return count + 1;               // FIELD
    }

    /** CONTROL: a genuine local, read after its declaration. */
    public int after() {
        int count = 2;
        return count;                   // LOCAL_VARIABLE
    }

    /**
     * CONTROL for the other direction: a lambda PARAMETER is a binding, even when a local of the
     * same name was declared in a SIBLING lambda. Scoping the locals without scoping the lambda
     * parameters too reads this one as the field, which is the trade this must not make. The shape
     * is dubbo's `PortUnificationExchanger.bind`, where the corpus run caught exactly that.
     */
    public String lambdaParameter(String addr) {
        Map<String, String> servers = new HashMap<>();
        servers.computeIfAbsent(addr, key -> {
            String reader = "made:" + key;   // a local named `reader`, in this lambda only
            return reader;                   // LOCAL_VARIABLE
        });
        servers.computeIfPresent(addr, (key, reader) -> reader.toUpperCase());  // the parameter
        return servers.get(addr);
    }
}
