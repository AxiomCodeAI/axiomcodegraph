package testcases.persistence;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.NamedQueries;
import jakarta.persistence.NamedQuery;

@Entity
@NamedQueries({
    @NamedQuery(name = "PetType.byName", query = "SELECT pt FROM PetType pt WHERE pt.name = :name"),
    @NamedQuery(name = "PetType.all", query = "FROM PetType pt ORDER BY pt.name")
})
public class PetType {
    @Id
    private Integer id;
    private String name;
}
