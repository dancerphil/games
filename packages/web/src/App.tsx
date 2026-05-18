import { createBrowserRouter, RouterProvider } from 'react-router';
import { EmperorSlavePage } from './pages/emperor-slave/EmperorSlavePage';
import { HomePage } from './pages/home/HomePage';
import { NinePage } from './pages/nine/NinePage';
import { TicTacToePage } from './pages/tic-tac-toe/TicTacToePage';

const router = createBrowserRouter([
    { path: '/', element: <HomePage /> },
    { path: '/tic-tac-toe', element: <TicTacToePage /> },
    { path: '/emperor-slave', element: <EmperorSlavePage /> },
    { path: '/nine', element: <NinePage /> },
]);

export const App = () => <RouterProvider router={router} />;
