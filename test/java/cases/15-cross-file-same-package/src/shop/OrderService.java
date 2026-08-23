package shop;

// CROSS-FILE, SAME PACKAGE — no imports involved. Every target lives in a DIFFERENT FILE of the
// same package, so resolution must work by same-package visibility alone. Case 13 only covered
// same-FILE qualifiers, which is the easier half.
public class OrderService {

    private final PriceCalculator calc = new PriceCalculator();   // sibling-file type, ctor
    private Discount discount;                                    // sibling-file interface

    public void useDiscount(Discount d) { this.discount = d; }

    public int total(int units) {
        int base = calc.subtotal(units);          // instance call into a sibling file
        int net  = PriceCalculator.tax(base);     // STATIC qualified by a sibling-file type name
        return discount.apply(net);               // interface declared in a sibling file -> CHA
    }

    public static void main(String[] args) {
        OrderService s = new OrderService();
        s.useDiscount(new PercentDiscount(10));
        System.out.println(s.total(3));
    }
}
