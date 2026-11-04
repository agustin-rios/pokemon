import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { makeStore } from './app/store.ts';
import { routes } from './routes.tsx';

const store = makeStore();
const router = createBrowserRouter(routes);
const theme = createTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Falta el elemento #root en index.html');

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RouterProvider router={router} />
      </ThemeProvider>
    </Provider>
  </StrictMode>,
);
