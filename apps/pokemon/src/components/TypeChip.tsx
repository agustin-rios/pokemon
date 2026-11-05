import { Chip, type ChipProps } from '@mui/material';

/** Colores habituales de cada tipo de Pokémon. */
const TYPE_COLORS: Record<string, string> = {
  normal: '#A8A77A',
  fire: '#EE8130',
  water: '#6390F0',
  electric: '#F7D02C',
  grass: '#7AC74C',
  ice: '#96D9D6',
  fighting: '#C22E28',
  poison: '#A33EA1',
  ground: '#E2BF65',
  flying: '#A98FF3',
  psychic: '#F95587',
  bug: '#A6B91A',
  rock: '#B6A136',
  ghost: '#735797',
  dragon: '#6F35FC',
  dark: '#705746',
  steel: '#B7B7CE',
  fairy: '#D685AD',
};

export function TypeChip({
  name,
  size = 'small',
}: {
  name: string;
  size?: ChipProps['size'];
}) {
  const color = TYPE_COLORS[name] ?? '#9E9E9E';
  return (
    <Chip
      label={name}
      size={size}
      sx={{
        bgcolor: color,
        color: (theme) => theme.palette.getContrastText(color),
        textTransform: 'capitalize',
        fontWeight: 500,
      }}
    />
  );
}
