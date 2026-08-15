const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * `react-native-maps` has no web build. Every screen is meant to import from
 * `@/utils/maps`, which Metro swaps for `utils/maps.web.ts` on web. A screen
 * that reaches for the package directly bundles fine on native and takes the
 * web export down at module resolution — which is exactly how `map-picker` and
 * `admin-session-history` regressed, unnoticed until someone ran the export.
 * CI lints all three apps, so this turns that bypass into a build failure.
 *
 * Only the static `import` form is restricted. The `Platform.OS !== "web"`
 * guarded `require()` that several legacy screens use is a different,
 * deliberate pattern that web already tolerates, and is left alone.
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
