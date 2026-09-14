package expressions;

public class QualifiedConstructorTest {
    // Fully qualified constructor calls - these should be broken down recursively
    private java.util.Random random = new java.util.Random();
    private java.util.ArrayList<String> list = new java.util.ArrayList<String>();
    private java.util.HashMap<String, Integer> map = new java.util.HashMap<String, Integer>();
    
    // Simple constructor call for comparison
    private String simple = new String("test");
}
