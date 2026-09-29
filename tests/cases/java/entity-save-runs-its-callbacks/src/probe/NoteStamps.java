package probe;

import jakarta.persistence.PrePersist;

/** control: a class with a callback that no entity names, so no save runs it. */
public class NoteStamps {
    @PrePersist
    void onCreate(Note note) { }
}
