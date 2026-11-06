import { useEffect } from 'react';
import {
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  LinearProgress,
  Toolbar,
  Typography,
  type ChipProps,
} from '@mui/material';
import { Link, NavLink, Outlet } from 'react-router';
import { useAppDispatch, useAppSelector } from './app/hooks.ts';
import { selectIsFetching } from './app/selectors.ts';
import {
  fetchHealth,
  selectHealthStatus,
  type HealthStatus,
} from './features/health/healthSlice.ts';

const navLinkSx = { '&.active': { textDecoration: 'underline' } };

const apiStatusChip: Record<
  HealthStatus,
  Pick<ChipProps, 'label' | 'color'>
> = {
  idle: { label: 'API: verificando…', color: 'default' },
  loading: { label: 'API: verificando…', color: 'default' },
  ok: { label: 'API: conectada', color: 'success' },
  error: { label: 'API: sin conexión', color: 'error' },
};

/** Layout: navegación, estado de la API y barra de carga en cada transición. */
export function App() {
  const dispatch = useAppDispatch();
  const health = useAppSelector(selectHealthStatus);
  const isFetching = useAppSelector(selectIsFetching);

  useEffect(() => {
    const request = dispatch(fetchHealth());
    return () => request.abort();
  }, [dispatch]);

  return (
    <>
      <AppBar position="sticky">
        <Toolbar component="nav" sx={{ gap: 1 }}>
          <Typography
            variant="h6"
            component={Link}
            to="/items"
            sx={{ color: 'inherit', textDecoration: 'none', mr: 2 }}
          >
            Pokédex
          </Typography>
          <Button
            color="inherit"
            component={NavLink}
            to="/items"
            sx={navLinkSx}
          >
            Pokémon
          </Button>
          <Button
            color="inherit"
            component={NavLink}
            to="/reports"
            sx={navLinkSx}
          >
            Reportes
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Chip size="small" {...apiStatusChip[health]} />
        </Toolbar>
        {/* Siempre ocupa su lugar: solo se hace visible para no mover la página. */}
        <LinearProgress
          color="secondary"
          aria-label="Cargando datos"
          aria-hidden={!isFetching}
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            visibility: isFetching ? 'visible' : 'hidden',
          }}
        />
      </AppBar>
      <Container component="main" maxWidth="xl" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </>
  );
}
