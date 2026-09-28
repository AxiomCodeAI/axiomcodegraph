// Props arrive destructured; the onToggle prop is whatever the element passed.
export default function TodoItem({ todo, onToggle }) {
  return <li onClick={() => onToggle(todo)}>{todo.text}</li>;
}
