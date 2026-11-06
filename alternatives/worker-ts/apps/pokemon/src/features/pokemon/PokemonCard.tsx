import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { Link } from 'react-router';
import type { Pokemon } from '../../api/pokedexApi.ts';
import { TypeChip } from '../../components/TypeChip.tsx';
import {
  kilograms,
  meters,
  number,
  pokemonName,
  pokemonNumber,
} from '../../lib/format.ts';

const MEDIA_HEIGHT = 160;

/** Imagen del Pokémon: el sprite es pixel art, se escala sin suavizar. */
export function PokemonImage({
  sprite,
  name,
  height,
}: {
  sprite: string | null;
  name: string;
  height: number;
}) {
  if (!sprite) {
    return (
      <Box
        sx={{
          height,
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'grey.100',
          color: 'text.disabled',
        }}
      >
        Sin imagen
      </Box>
    );
  }
  return (
    <CardMedia
      component="img"
      image={sprite}
      alt={pokemonName(name)}
      sx={{
        height,
        objectFit: 'contain',
        imageRendering: 'pixelated',
        bgcolor: 'grey.100',
      }}
    />
  );
}

/** Tarjeta de la lista; lleva al detalle recordando la página de origen. */
export function PokemonCard({
  pokemon,
  fromPage,
}: {
  pokemon: Pokemon;
  fromPage: number;
}) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea
        component={Link}
        to={`/item/${pokemon.id}`}
        state={{ fromPage }}
        sx={{ height: '100%', alignItems: 'stretch' }}
      >
        <PokemonImage
          sprite={pokemon.sprite}
          name={pokemon.name}
          height={MEDIA_HEIGHT}
        />
        <CardContent>
          <Typography variant="caption" color="text.secondary">
            {pokemonNumber(pokemon.id)}
          </Typography>
          <Typography variant="h6" component="h2" gutterBottom>
            {pokemonName(pokemon.name)}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ mb: 1.5 }}>
            {pokemon.types.map((type) => (
              <TypeChip key={type.id} name={type.name} />
            ))}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Exp. base {number(pokemon.baseExperience)} ·{' '}
            {meters(pokemon.height)} · {kilograms(pokemon.weight)}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export function PokemonCardSkeleton() {
  return (
    <Card sx={{ height: '100%' }}>
      <Skeleton variant="rectangular" height={MEDIA_HEIGHT} />
      <CardContent>
        <Skeleton width="25%" />
        <Skeleton width="60%" height={32} />
        <Skeleton width="45%" />
        <Skeleton width="80%" />
      </CardContent>
    </Card>
  );
}
