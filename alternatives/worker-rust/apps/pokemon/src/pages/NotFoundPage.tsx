import { Button, Stack, Typography } from '@mui/material';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="h4" component="h1">
        Página no encontrada
      </Typography>
      <Button variant="contained" component={Link} to="/items">
        Ir a la Pokédex
      </Button>
    </Stack>
  );
}
