package probe;

import jakarta.persistence.EntityManager;

public class Catalog {
    private final ItemRepository items;
    private final NoteRepository notes;
    private final EntityManager em;
    private final Shelf shelf = new Shelf();

    public Catalog(ItemRepository items, NoteRepository notes, EntityManager em) {
        this.items = items;
        this.notes = notes;
        this.em = em;
    }

    /** save through a Spring Data repository: the persist and update callbacks of Item and of its superclass. */
    public void add(String name) {
        Item item = new Item();
        item.rename(name);
        items.save(item);
    }

    /** delete: the remove callbacks only. */
    public void remove(Item item) {
        items.delete(item);
    }

    /** EntityManager.persist: the persist callbacks only. */
    public void importItem(Item item) {
        em.persist(item);
    }

    /** control: a Note has no callbacks, and NoteStamps is named by no entity. */
    public void jot(String text) {
        Note note = new Note();
        notes.save(note);
    }

    /** control: a project method that happens to be called save. */
    public void display(Item item) {
        shelf.save(item);
    }
}
