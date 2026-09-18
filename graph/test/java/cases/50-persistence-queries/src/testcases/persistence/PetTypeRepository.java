package testcases.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

/**
 * Spring Data: there is no call site anywhere. The framework generates the
 * implementation, so the annotated method is what touches the schema.
 */
public interface PetTypeRepository extends JpaRepository<PetType, Integer> {

    @Query("SELECT pt FROM PetType pt ORDER BY pt.name")
    List<PetType> findAllOrdered();
}
