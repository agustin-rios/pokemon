import { useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Grid,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';
import { Link, useLocation, useParams } from 'react-router';
import type { Pokemon } from '../api/pokedexApi.ts';
import { useAppDispatch, useAppSelector } from '../app/hooks.ts';
import { RequestState } from '../components/RequestState.tsx';
import { TypeChip } from '../components/TypeChip.tsx';
import { PokemonImage } from '../features/pokemon/PokemonCard.tsx';
import {
  fetchPokemon,
  selectPokemonById,
  selectPokemonRequest,
} from '../features/pokemon/pokemonSlice.ts';
import {
  kilograms,
  meters,
  number,
  pokemonName,
  pokemonNumber,
} from '../lib/format.ts';

const IMAGE_HEIGHT = 280;

function PokemonDetail({ pokemon }: { pokemon: Pokemon }) {
  return (
    <Card>
      <Grid container>
        <Grid size={{ xs: 12, md: 5 }}>
          <PokemonImage
            sprite={pokemon.sprite}
            name={pokemon.name}
            height={IMAGE_HEIGHT}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              {pokemonNumber(pokemon.id)}
            </Typography>
            <Typography variant="h4" component="h1" gutterBottom>
              {pokemonName(pokemon.name)}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              {pokemon.types.map((type) => (
                <TypeChip key={type.id} name={type.name} size="medium" />
              ))}
            </Stack>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell component="th">Altura</TableCell>
                  <TableCell>{meters(pokemon.height)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell component="th">Peso</TableCell>
                  <TableCell>{kilograms(pokemon.weight)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell component="th">Experiencia base</TableCell>
                  <TableCell>{number(pokemon.baseExperience)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Grid>
      </Grid>
    </Card>
  );
}

function PokemonDetailSkeleton() {
  return (
    <Card>
      <Grid container>
        <Grid size={{ xs: 12, md: 5 }}>
          <Skeleton variant="rectangular" height={IMAGE_HEIGHT} />
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <CardContent>
            <Skeleton width="20%" />
            <Skeleton width="50%" height={48} />
            <Skeleton width="30%" height={36} />
            <Skeleton height={120} />
          </CardContent>
        </Grid>
      </Grid>
    </Card>
  );
}

/** /item/:id: un Pokémon con sus tipos. 404 si no existe; desde caché si ya se vio. */
export function PokemonDetailPage() {
  const dispatch = useAppDispatch();
  const { id: idParam = '' } = useParams();
  const id = Number(idParam);
  const isValidId = Number.isInteger(id) && id > 0;
  const location = useLocation();
  const fromPage = (location.state as { fromPage?: number } | null)?.fromPage;

  const pokemon = useAppSelector((state) => selectPokemonById(state, id));
  const request = useAppSelector((state) => selectPokemonRequest(state, id));

  useEffect(() => {
    // Si ya vino en la lista, el thunk no vuelve a la API (condition).
    if (isValidId) void dispatch(fetchPokemon(id));
  }, [dispatch, id, isValidId]);

  const backHref =
    fromPage && fromPage > 1 ? `/items?page=${fromPage}` : '/items';
  const notFound =
    !isValidId ||
    request.error?.status === 404 ||
    request.error?.status === 400;

  return (
    <Stack spacing={2}>
      <div>
        <Button component={Link} to={backHref}>
          ← Volver a la lista
        </Button>
      </div>
      {notFound ? (
        <Alert severity="warning">No existe el Pokémon «{idParam}».</Alert>
      ) : (
        <RequestState
          status={request.status}
          error={request.error}
          onRetry={() => void dispatch(fetchPokemon(id))}
          skeleton={<PokemonDetailSkeleton />}
        >
          {pokemon && <PokemonDetail pokemon={pokemon} />}
        </RequestState>
      )}
    </Stack>
  );
}
