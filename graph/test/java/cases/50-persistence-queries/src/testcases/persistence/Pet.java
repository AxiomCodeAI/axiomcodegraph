package testcases.persistence;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

/**
 * Deliberately named so that "Pet" is a PREFIX of "PetType". A query naming PetType
 * must not be reported as touching Pet — matching " FROM Pet" without requiring a
 * delimiter after the name did exactly that on a real codebase.
 */
@Entity
public class Pet {
    @Id
    private Integer id;
    private String name;
    private String nickname;
}
