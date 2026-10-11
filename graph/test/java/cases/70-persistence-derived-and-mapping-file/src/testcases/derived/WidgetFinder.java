package testcases.derived;

import java.util.List;

/** Control: the same method name on an interface that extends no repository base. */
public interface WidgetFinder {
    List<Widget> findByColor(String color);
}
