import { reactConfig } from '@hero-u/eslint-config/react.js';

export default [
    ...reactConfig,
    {
        files: ['**/*.config.{ts,js,mjs}'],
        rules: {
            'import-x/no-default-export': 'off',
        },
    },
];
