package testcases.derived;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

/**
 * Spring Data derives a query from each method NAME: the properties it spells are the
 * ones a rename breaks at start-up.
 */
public interface WidgetRepository extends JpaRepository<Widget, Long> {

    List<Widget> findByColor(String color);

    long countByLabelStartingWith(String prefix);

    // the longer property wins where two start at one place: labelText, not label
    List<Widget> findDistinctByColorAndLabelTextOrderByIdDesc(String color, String text);

    boolean existsByWeightGreaterThan(int weight);

    // control: @Query carries the text, and the name is not parsed
    @Query("SELECT w FROM Widget w WHERE w.label = :label")
    List<Widget> findByNothingAtAll(String label);

    // control: no subject keyword, so the name is not a derived query
    List<Widget> byColor(String color);

    // control: a default method has a body, and Spring runs that body
    default List<Widget> findByColorTwice(String color) {
        return findByColor(color);
    }
}
