import { TodoList } from './components/TodoList.jsx';
import Panel from './components/Panel.jsx';
import * as ui from './components/ui.jsx';

// CONTROL: a project function spelled like an intrinsic tag. `<div/>` is intrinsic and
// must not become an edge to it.
function div() { return 'not a component'; }

// CONTROL: named only in a string, never rendered — no edge.
function Unused() { return null; }
const label = 'Unused';

export default function App({ title }) {
  const extra = { onClose: closeAll };
  return (
    <div className={label}>
      <TodoList heading={title} />
      <Panel {...extra} />
      <ui.Badge count={1} />
      <ui.List>{(item) => format(item)}</ui.List>
    </div>
  );
}

function closeAll() { return div(); }
function format(item) { return String(item); }
