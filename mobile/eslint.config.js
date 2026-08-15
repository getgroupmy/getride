const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * `react-native-maps` has no web build. Every screen goes through
 * `@/utils/maps`, which Metro swaps for `utils/maps.web.ts` on web. Importing
 * the package directly bundles fine on native and takes the web export down at
 * module resolution — a failure nothing catches until someone runs the export.
 * CI lints all three apps, so this makes the bypass a build failure instead.
 */
const NO_DIRECT_MAPS_IMPORT = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: 'react-native-maps',
          message:
            'Import from "@/utils/maps" instead — react-native-maps has no web build, and utils/maps.web.ts is the override that keeps the web export working.',
        },
      ],
    },
  ],
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: NO_DIRECT_MAPS_IMPORT,
  },
  {
    // The abstraction itself is the one place allowed to import the package.
    files: ["utils/maps.ts", "utils/maps.web.ts"],
    rules: { 'no-restricted-imports': 'off' },
  },
]);
