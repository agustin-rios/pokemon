import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { MonthlyCaptureGrowth } from '../../api/pokedexApi.ts';
import { month, percent } from '../../lib/format.ts';

function Change({ value }: { value: number | null }) {
  if (value === null) {
    return <Typography color="text.secondary">—</Typography>;
  }
  const up = value > 0;
  const down = value < 0;
  return (
    <Typography
      component="span"
      color={up ? 'success.main' : down ? 'error.main' : 'text.secondary'}
      sx={{ fontWeight: 500 }}
    >
      {up ? '▲ ' : down ? '▼ ' : ''}
      {percent(Math.abs(value))}
    </Typography>
  );
}

/** Consulta A: capturas por mes y variación vs. el mes anterior. */
export function MonthlyGrowthTable({ rows }: { rows: MonthlyCaptureGrowth[] }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Mes</TableCell>
          <TableCell align="right">Capturas</TableCell>
          <TableCell align="right">vs. mes anterior</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.month}>
            <TableCell sx={{ textTransform: 'capitalize' }}>
              {month(row.month)}
            </TableCell>
            <TableCell align="right">{row.captures}</TableCell>
            <TableCell align="right">
              <Change value={row.changePercent} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
