package app.jpa;

// CONTROL: the converter's method names on a class nothing registers
public class LooseConverter {
    public Long convertToDatabaseColumn(Price p) { return p.cents; }
}
