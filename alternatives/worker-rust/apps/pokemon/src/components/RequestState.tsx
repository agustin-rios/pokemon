import type { ReactNode } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import { LoadDataButton } from '../features/etl/LoadDataButton.tsx';
import type { RequestError, RequestStatus } from '../features/request.ts';

interface RequestStateProps {
  status: RequestStatus;
  error: RequestError | null;
  onRetry: () => void;
  /** Lo que se ve mientras carga, con la forma del contenido. */
  skeleton: ReactNode;
  children: ReactNode;
}

/**
 * Cómo se ve una sección según su petición: esqueleto mientras carga, aviso
 * con "Cargar datos" si la base aún no tiene datos (503), error con
 * reintento o el contenido.
 */
export function RequestState({
  status,
  error,
  onRetry,
  skeleton,
  children,
}: RequestStateProps): ReactNode {
  if (status === 'idle' || status === 'loading') return skeleton;

  if (status === 'failed') {
    const retry = (
      <Button color="inherit" size="small" onClick={onRetry}>
        Reintentar
      </Button>
    );
    if (error?.status === 503) {
      return (
        <Stack spacing={2}>
          <Alert severity="info" action={retry}>
            Los datos todavía no están cargados.
          </Alert>
          <LoadDataButton />
        </Stack>
      );
    }
    return (
      <Alert severity="error" action={retry}>
        No se pudo cargar: {error?.message ?? 'error desconocido'}
      </Alert>
    );
  }

  return children;
}
