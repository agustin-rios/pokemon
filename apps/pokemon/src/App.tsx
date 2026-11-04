import { AppBar, Button, Container, Toolbar } from '@mui/material';
import { NavLink, Outlet } from 'react-router';

const navLinkSx = { '&.active': { textDecoration: 'underline' } };

export function App() {
  return (
    <>
      <AppBar position="static">
        <Toolbar component="nav" sx={{ gap: 1 }}>
          <Button color="inherit" component={NavLink} to="/" end sx={navLinkSx}>
            Inicio
          </Button>
          <Button
            color="inherit"
            component={NavLink}
            to="/about"
            sx={navLinkSx}
          >
            Acerca de
          </Button>
        </Toolbar>
      </AppBar>
      <Container component="main" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </>
  );
}
