import { AuthProvider, ThemeProvider, LogoutButton, LogoutLink, ThemeButton } from './Auth';
import Menu from './Menu';
import ConnectedSettings from './Settings';
import ConnectedProfile from './Profile';
import { Plain } from './Plain';

export function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <LogoutButton /><LogoutLink /><ThemeButton /><Menu />
        <ConnectedSettings /><ConnectedProfile /><Plain />
      </ThemeProvider>
    </AuthProvider>
  );
}
