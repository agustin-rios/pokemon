import { Navigate, type RouteObject } from 'react-router';
import { App } from './App.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { PokemonDetailPage } from './pages/PokemonDetailPage.tsx';
import { PokemonListPage } from './pages/PokemonListPage.tsx';
import { LevelClassificationPage } from './pages/reports/LevelClassificationPage.tsx';
import { MonthlyGrowthPage } from './pages/reports/MonthlyGrowthPage.tsx';
import { ReportsLayout } from './pages/reports/ReportsLayout.tsx';
import { TopTrainersPage } from './pages/reports/TopTrainersPage.tsx';

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: App,
    children: [
      { index: true, element: <Navigate to="/items" replace /> },
      { path: 'items', Component: PokemonListPage },
      { path: 'item/:id', Component: PokemonDetailPage },
      {
        path: 'reports',
        Component: ReportsLayout,
        children: [
          { index: true, element: <Navigate to="monthly-growth" replace /> },
          { path: 'monthly-growth', Component: MonthlyGrowthPage },
          { path: 'top-trainers', Component: TopTrainersPage },
          { path: 'level-classification', Component: LevelClassificationPage },
        ],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
