import { reactConfig } from '@hero-u/eslint-config/react.js';

export default [
    ...reactConfig,
    {
        rules: {
            'max-lines': 'off',
        },
    },
];
