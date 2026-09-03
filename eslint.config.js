import { reactConfig } from '@hero-u/eslint-config/react.js';

export default [
    ...reactConfig,
    {
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        rules: {
            'curly': 'off',
            'max-lines': 'off',
            '@stylistic/max-statements-per-line': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            'complexity': 'off',
            '@eslint-react/set-state-in-effect': 'off',
            'react-hooks/immutability': 'off',
            'react-hooks/set-state-in-effect': 'off',
            '@eslint-react/use-state': 'off',
            'import-x/no-default-export': 'off',
            'import-x/order': 'off',
            'no-useless-assignment': 'off',
            'no-restricted-syntax': 'off',
            'max-depth': 'off',
            '@eslint-react/web-api-no-leaked-fetch': 'off',
            'no-irregular-whitespace': 'off',
        },
    },
];
