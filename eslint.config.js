import { reactConfig } from '@hero-u/eslint-config/react.js';

export default [
    ...reactConfig,
    {
        rules: {
            'curly': 'off',
            'max-lines': 'off',
        },
    },
];
