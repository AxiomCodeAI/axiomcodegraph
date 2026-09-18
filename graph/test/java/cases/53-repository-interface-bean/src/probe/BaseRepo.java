package probe;

import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.NoRepositoryBean;

/**
 * CONTROL: a house base over an unresolved framework base. @NoRepositoryBean says the
 * framework proxies its children and not this, so it must NOT be a bean even though
 * it matches the suffix.
 */
@NoRepositoryBean
public interface BaseRepo<T> extends CrudRepository<T, String> {
}
