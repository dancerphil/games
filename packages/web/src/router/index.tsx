import { createBrowserRouter } from 'react-router';
import { HomePage } from '../pages/home/HomePage';
import { RoomPage } from '../pages/room/RoomPage';

export const router = createBrowserRouter([
    { path: '/', element: <HomePage /> },
    { path: '/room/:roomId', element: <RoomPage /> },
]);
