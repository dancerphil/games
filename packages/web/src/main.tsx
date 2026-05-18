import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { StrictMode } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) {
    throw new Error('Root element not found');
}

createRoot(root).render(
    <StrictMode>
        <MantineProvider>
            <Notifications />
            <App />
        </MantineProvider>
    </StrictMode>,
);
