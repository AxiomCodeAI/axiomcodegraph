package app;
import jakarta.persistence.*;
@Entity
public class Widget {
    @Id Long id;
    String color;
    String label;
    String labelText;
}
