import { useEffect } from 'react';
import { Chip, Stack, Typography, type ChipProps } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../app/hooks.ts';
import {
  fetchHealth,
  selectHealthStatus,
  type HealthStatus,
} from '../features/health/healthSlice.ts';

const apiStatusChip: Record<
  HealthStatus,
  Pick<ChipProps, 'label' | 'color'>
> = {
  idle: { label: 'API: verificando…', color: 'default' },
  loading: { label: 'API: verificando…', color: 'default' },
  ok: { label: 'API: conectada', color: 'success' },
  error: { label: 'API: sin conexión', color: 'error' },
};

export function HomePage() {
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectHealthStatus);

  useEffect(() => {
    const request = dispatch(fetchHealth());
    return () => request.abort();
  }, [dispatch]);

  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="h3" component="h1">
        Pokemon
      </Typography>
      <Chip {...apiStatusChip[status]} />
    </Stack>
  );
}
