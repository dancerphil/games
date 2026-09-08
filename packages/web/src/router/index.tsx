import { createBrowserRouter } from 'react-router';
import { HomePage } from '../pages/home/HomePage';
import { RoomPage } from '../pages/room/RoomPage';
import { GomokuBattle } from '../pages/gomoku/GomokuBattle';
import { SelfplayPage } from '../pages/selfplay/SelfplayPage';

export const router = createBrowserRouter([
    { path: '/', element: <HomePage /> },
    { path: '/room/:roomId', element: <RoomPage /> },
    { path: '/battle', element: <GomokuBattle /> },
    { path: '/selfplay', element: <SelfplayPage /> },
]);
