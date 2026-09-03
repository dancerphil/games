import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { StrictMode } from 'react';
import { useEffect } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { useAppStore } from './store';

const Init = () => {
    const init = useAppStore(s => s.init);
    useEffect(() => init(), [init]);
    return <RouterProvider router={router} />;
};

const root = document.getElementById('root');
if (!root) {
    throw new Error('Root element not found');
}

createRoot(root).render(
    <StrictMode>
        <MantineProvider>
            <Notifications />
            <Init />
        </MantineProvider>
    </StrictMode>,
);
