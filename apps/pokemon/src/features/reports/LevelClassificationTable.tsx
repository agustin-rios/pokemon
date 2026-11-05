import {
  Box,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material';
import type { LevelClassification } from '../../api/pokedexApi.ts';
import { TypeChip } from '../../components/TypeChip.tsx';
import { percent } from '../../lib/format.ts';

/** Consulta C: por tipo, capturas con nivel ≥ 50 y qué parte representan. */
export function LevelClassificationTable({
  rows,
}: {
  rows: LevelClassification[];
}) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Tipo</TableCell>
          <TableCell align="right">Capturas</TableCell>
          <TableCell align="right">Nivel ≥ 50</TableCell>
          <TableCell sx={{ width: '35%' }}>% del tipo</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.typeId}>
            <TableCell>
              <TypeChip name={row.typeName} />
            </TableCell>
            <TableCell align="right">{row.totalCaptures}</TableCell>
            <TableCell align="right">{row.highLevelCaptures}</TableCell>
            <TableCell>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={row.highLevelPercent}
                  aria-label={`${row.typeName}: ${percent(row.highLevelPercent)}`}
                  sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                />
                <Box component="span" sx={{ minWidth: 64, textAlign: 'right' }}>
                  {percent(row.highLevelPercent)}
                </Box>
              </Box>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
