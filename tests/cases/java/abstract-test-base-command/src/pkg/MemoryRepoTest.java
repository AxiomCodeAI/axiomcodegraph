package pkg;

public class MemoryRepoTest extends AbstractRepoContractTest {
    @Override
    protected Repo repo() {
        return new Repo();
    }
}
