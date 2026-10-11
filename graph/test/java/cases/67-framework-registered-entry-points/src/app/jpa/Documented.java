package app.jpa;

// an unrelated annotation whose argument is a class
public @interface Documented {
    Class<?> by();
}
