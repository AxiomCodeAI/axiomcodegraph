export class Column {
  isVirtual(): boolean { return false; }
}

export class Meta {
  // A FIELD whose declared type is a container.
  columns: Column[] = [];
  // A GETTER whose declared return type is a container.
  get active(): Column[] { return this.columns; }
}

export class Builder {
  constructor(private meta: Meta) {}

  // (1) a field on a PARAMETER-PROPERTY receiver, declared type is an array
  viaField(): Column[] {
    return this.meta.columns.filter((c) => c.isVirtual());
  }

  // (2) the same through a getter
  viaGetter(): Column[] {
    return this.meta.active.filter((c) => c.isVirtual());
  }

  // (3) a local whose initializer is a PROPERTY ACCESS (initializerKind=UNKNOWN)
  viaLocal(): Column[] {
    const cols = this.meta.columns;
    return cols.filter((c) => c.isVirtual());
  }
}

// CONTROL: a directly annotated array receiver must keep working.
export function viaAnnotated(cols: Column[]): Column[] {
  return cols.filter((c) => c.isVirtual());
}
