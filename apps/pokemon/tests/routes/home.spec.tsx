import { createRoutesStub } from 'react-router';
import { render, screen } from '@testing-library/react';
import Home from '../../app/routes/home';

test('renders the home heading', async () => {
  const ReactRouterStub = createRoutesStub([
    {
      path: '/',
      Component: Home,
    },
  ]);

  render(<ReactRouterStub />);

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Pokemon' }),
  ).toBeTruthy();
});
