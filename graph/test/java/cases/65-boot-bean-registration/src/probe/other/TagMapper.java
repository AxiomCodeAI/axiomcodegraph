package probe.other;

/** CONTROL: outside every @MapperScan package and not annotated. Stays unsatisfied. */
public interface TagMapper {
    int tag(Long id);
}
