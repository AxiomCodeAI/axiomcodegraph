package testcases.derived;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class Widget {
    @Id Long id;
    String color;
    String label;
    String labelText;
    int weight;
}
