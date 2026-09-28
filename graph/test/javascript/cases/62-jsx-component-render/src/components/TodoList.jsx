import TodoItem from './TodoItem.jsx';

export function TodoList({ heading }) {
  function handleToggle(todo) { return save(todo); }
  const todos = [{ text: heading }];
  return <ul>{todos.map((t) => <TodoItem key={t.text} todo={t} onToggle={handleToggle} />)}</ul>;
}

function save(todo) { return todo; }
