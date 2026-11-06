import { useEffect } from 'react';
import {
  Button,
  Card,
  CardActions,
  CardContent,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link } from 'react-router';
import { useAppDispatch, useAppSelector } from '../../app/hooks.ts';
import { RequestState } from '../../components/RequestState.tsx';
import { TypeChip } from '../../components/TypeChip.tsx';
import { number } from '../../lib/format.ts';
import { fetchTypeSummary, selectTypeSummary } from './typeSummarySlice.ts';

/** Resumen por tipo (GET /items/summary) y el acceso a los reportes. */
export function TypeSummaryPanel() {
  const dispatch = useAppDispatch();
  const summary = useAppSelector(selectTypeSummary);

  useEffect(() => {
    // Si ya está en el store, el thunk no vuelve a la API (condition).
    void dispatch(fetchTypeSummary());
  }, [dispatch]);

  return (
    <Card component="aside" aria-labelledby="type-summary-title">
      <CardContent>
        <Typography id="type-summary-title" variant="h6" component="h2">
          Resumen por tipo
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Pokémon y experiencia base promedio. Un Pokémon con dos tipos cuenta
          en ambos.
        </Typography>
        <RequestState
          status={summary.status}
          error={summary.error}
          onRetry={() => void dispatch(fetchTypeSummary())}
          skeleton={Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} height={32} />
          ))}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tipo</TableCell>
                <TableCell align="right">Pokémon</TableCell>
                <TableCell align="right">Exp. prom.</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(summary.data ?? []).map((row) => (
                <TableRow key={row.typeId}>
                  <TableCell>
                    <TypeChip name={row.typeName} />
                  </TableCell>
                  <TableCell align="right">{row.pokemonCount}</TableCell>
                  <TableCell align="right">
                    {number(row.averageBaseExperience)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </RequestState>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2 }}>
        <Button variant="contained" component={Link} to="/reports" fullWidth>
          Ver reportes
        </Button>
      </CardActions>
    </Card>
  );
}
