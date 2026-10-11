package app;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
public interface WidgetRepository extends JpaRepository<Widget, Long> {
    List<Widget> findByColor(String color);

    long countByLabelStartingWith(String prefix);

    List<Widget> findDistinctByColorAndLabelTextOrderByIdDesc(String c, String t);

    @Query("SELECT w FROM Widget w WHERE w.label = :label")
    List<Widget> byLabel(String label);

    List<Widget> byColorName(String color);
}
