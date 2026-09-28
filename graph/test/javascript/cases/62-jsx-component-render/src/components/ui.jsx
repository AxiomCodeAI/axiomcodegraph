export function Badge(props) { return <span>{props.count}</span>; }
// A render prop: the brace child is props.children.
export function List(props) { return <ol>{[1, 2].map((x) => props.children(x))}</ol>; }
