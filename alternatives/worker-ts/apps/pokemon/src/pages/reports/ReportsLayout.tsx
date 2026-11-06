import { Box, Tab, Tabs, Typography } from '@mui/material';
import { Link, Outlet, useLocation } from 'react-router';

const REPORTS = [
  { path: '/reports/monthly-growth', label: 'Crecimiento mensual' },
  { path: '/reports/top-trainers', label: 'Top entrenadores' },
  { path: '/reports/level-classification', label: 'Nivel por tipo' },
] as const;

/** /reports: pestañas sincronizadas con la URL; cada consulta es una ruta hija. */
export function ReportsLayout() {
  const { pathname } = useLocation();
  const current = REPORTS.find((report) => pathname === report.path)?.path;

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Reportes
      </Typography>
      <Tabs
        value={current ?? false}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        {REPORTS.map((report) => (
          <Tab
            key={report.path}
            value={report.path}
            label={report.label}
            component={Link}
            to={report.path}
          />
        ))}
      </Tabs>
      <Box sx={{ pt: 3 }}>
        <Outlet />
      </Box>
    </>
  );
}
