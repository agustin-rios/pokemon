import {
  Card,
  CardContent,
  Grid,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import type { TopTrainer } from '../../api/pokedexApi.ts';

const MEDALS = ['🥇', '🥈', '🥉'];

/** Consulta B: el top 3 de entrenadores de cada región, una tarjeta por región. */
export function TopTrainersByRegion({ rows }: { rows: TopTrainer[] }) {
  // Las filas llegan ordenadas por región y ranking: se agrupan en ese orden.
  const regions = new Map<string, TopTrainer[]>();
  for (const row of rows) {
    regions.set(row.region, [...(regions.get(row.region) ?? []), row]);
  }

  return (
    <Grid container spacing={2}>
      {[...regions].map(([region, trainers]) => (
        <Grid key={region} size={{ xs: 12, sm: 6, md: 4 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" component="h2">
                {region}
              </Typography>
              <List dense>
                {trainers.map((trainer) => (
                  <ListItem key={trainer.trainerId} disableGutters>
                    <ListItemText
                      primary={`${MEDALS[trainer.rank - 1] ?? `${trainer.rank}.`} ${trainer.trainerName}`}
                      secondary={`${trainer.captures} capturas`}
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
