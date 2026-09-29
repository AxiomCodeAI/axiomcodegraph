package probe;

import jakarta.persistence.Entity;

/** control: an entity that names no listener and has no callback of its own. */
@Entity
public class Note {
    String text;
}
