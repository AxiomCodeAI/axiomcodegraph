package pkg;

import org.junit.jupiter.api.Test;

public abstract class AbstractRepoContractTest {
    protected abstract Repo repo();

    @Test
    void savesOne() {
        repo().save(1);
    }
}
