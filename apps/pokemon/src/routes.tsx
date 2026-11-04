import type { RouteObject } from 'react-router';
import { App } from './App.tsx';
import { AboutPage } from './pages/AboutPage.tsx';
import { HomePage } from './pages/HomePage.tsx';

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: App,
    children: [
      { index: true, Component: HomePage },
      { path: 'about', Component: AboutPage },
    ],
  },
];
