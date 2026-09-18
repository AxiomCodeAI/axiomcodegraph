package testcases.persistence;

import jakarta.persistence.EntityManager;
import java.util.List;

public class PetStore {

    private EntityManager em;

    /** a NAMED query: only the string ties this to the declaration on PetType */
    public List<PetType> byName(String name) {
        return em.createNamedQuery("PetType.byName", PetType.class)
                .setParameter("name", name)
                .getResultList();
    }

    /** a named query whose text has no leading SELECT — it begins with FROM */
    public List<PetType> all() {
        return em.createNamedQuery("PetType.all", PetType.class).getResultList();
    }

    /** an INLINE query: the text is the argument */
    public List<Pet> byNickname(String nickname) {
        return em.createQuery("SELECT p FROM Pet p WHERE p.nickname = :nickname", Pet.class)
                .setParameter("nickname", nickname)
                .getResultList();
    }

    /** a name no @NamedQuery declares: reported, not dropped */
    public List<PetType> undeclared() {
        return em.createNamedQuery("PetType.noSuch", PetType.class).getResultList();
    }

    /** built at run time: no honest answer, so it is declared */
    public List<Pet> ordered(String column) {
        return em.createQuery("SELECT p FROM Pet p ORDER BY p." + column, Pet.class).getResultList();
    }
}
