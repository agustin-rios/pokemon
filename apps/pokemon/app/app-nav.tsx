import { NavLink } from 'react-router';

export function AppNav() {
  return (
    <nav>
      <NavLink to="/" end>
        Inicio
      </NavLink>
      <NavLink to="/about" end>
        Acerca de
      </NavLink>
    </nav>
  );
}
