import { useEffect, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Grid,
  Pagination,
  PaginationItem,
  Typography,
} from '@mui/material';
import { Link, useSearchParams } from 'react-router';
import { useAppDispatch, useAppSelector } from '../app/hooks.ts';
import { RequestState } from '../components/RequestState.tsx';
import {
  PokemonCard,
  PokemonCardSkeleton,
} from '../features/pokemon/PokemonCard.tsx';
import {
  PAGE_SIZE,
  fetchPokemonPage,
  selectPageCount,
  selectPokemonPage,
} from '../features/pokemon/pokemonSlice.ts';
import { TypeSummaryPanel } from '../features/typeSummary/TypeSummaryPanel.tsx';

/** `?page=` válido o 1. */
function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

const pageHref = (page: number) =>
  page === 1 ? '/items' : `/items?page=${page}`;

function CardGrid({ children }: { children: ReactNode }) {
  return (
    <Grid container spacing={2}>
      {children}
    </Grid>
  );
}

const cardSize = { xs: 12, sm: 6, lg: 4 } as const;

/** /items: Pokémon en tarjetas, paginados, con el resumen por tipo al costado. */
export function PokemonListPage() {
  const dispatch = useAppDispatch();
  const [searchParams] = useSearchParams();
  const page = parsePage(searchParams.get('page'));
  const { status, error, pokemon } = useAppSelector((state) =>
    selectPokemonPage(state, page),
  );
  const pageCount = useAppSelector(selectPageCount);

  useEffect(() => {
    // Una página ya visitada sale del store sin volver a la API (condition).
    void dispatch(fetchPokemonPage(page));
  }, [dispatch, page]);

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 8, lg: 9 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Pokédex
        </Typography>
        <RequestState
          status={status}
          error={error}
          onRetry={() => void dispatch(fetchPokemonPage(page))}
          skeleton={
            <CardGrid>
              {Array.from({ length: PAGE_SIZE }, (_, i) => (
                <Grid key={i} size={cardSize}>
                  <PokemonCardSkeleton />
                </Grid>
              ))}
            </CardGrid>
          }
        >
          {pokemon.length === 0 ? (
            <Alert severity="info">
              No hay Pokémon en esta página.{' '}
              <Link to="/items">Ir al inicio</Link>
            </Alert>
          ) : (
            <CardGrid>
              {pokemon.map((p) => (
                <Grid key={p.id} size={cardSize}>
                  <PokemonCard pokemon={p} fromPage={page} />
                </Grid>
              ))}
            </CardGrid>
          )}
        </RequestState>
        {pageCount !== null && pageCount > 1 && (
          <Pagination
            count={pageCount}
            page={Math.min(page, pageCount)}
            sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}
            renderItem={(item) => (
              <PaginationItem
                component={Link}
                to={pageHref(item.page ?? 1)}
                {...item}
              />
            )}
          />
        )}
      </Grid>
      {/* Al costado en escritorio; arriba de la lista en pantallas angostas. */}
      <Grid size={{ xs: 12, md: 4, lg: 3 }} sx={{ order: { xs: -1, md: 0 } }}>
        <Box sx={{ position: { md: 'sticky' }, top: { md: 24 } }}>
          <TypeSummaryPanel />
        </Box>
      </Grid>
    </Grid>
  );
}
