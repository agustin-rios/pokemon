import { Alert, Button, Stack } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../../app/hooks.ts';
import { selectEtl, triggerEtl } from './etlSlice.ts';

/** Dispara la carga de datos (POST /api/etl/runs) y muestra cómo le fue. */
export function LoadDataButton() {
  const dispatch = useAppDispatch();
  const etl = useAppSelector(selectEtl);

  return (
    <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Button
        variant="contained"
        onClick={() => void dispatch(triggerEtl())}
        disabled={etl.status === 'loading'}
      >
        {etl.status === 'loading' ? 'Iniciando carga…' : 'Cargar datos'}
      </Button>
      {etl.status === 'succeeded' && etl.data && (
        <Alert severity="success">
          Carga iniciada ({etl.data.runId}). En unos segundos los datos estarán
          listos: usa «Reintentar».
        </Alert>
      )}
      {etl.status === 'failed' && etl.error && (
        <Alert severity="error">
          No se pudo iniciar la carga: {etl.error.message}
        </Alert>
      )}
    </Stack>
  );
}
