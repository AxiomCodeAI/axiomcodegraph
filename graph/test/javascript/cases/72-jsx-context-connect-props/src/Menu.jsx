import { useAuth } from './Auth';

// through an imported hook, member read
export default function Menu() {
  const auth = useAuth();
  return <li onClick={auth.logout}>out</li>;
}
