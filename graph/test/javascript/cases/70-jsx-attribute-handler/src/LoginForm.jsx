import { createUser } from './actions';
import UserForm from './UserForm';

function logout() { return 'out'; }
function label() { return 'Save'; }

export default function LoginForm({ count }) {
  const submit = (e) => { e.preventDefault(); return 'in'; };
  const settings = { theme: 'dark' };
  return (
    <form onSubmit={submit}>
      <button type="button" onClick={logout}>out</button>
      <input value={count} className="field" title={label()} data-settings={settings} />
      <span onMouseEnter={() => label()}>hover</span>
      <UserForm action={createUser} />
    </form>
  );
}
