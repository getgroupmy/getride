/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  // Only *.test.* files are test suites — shared helpers live in test-utils/.
  testMatch: ["**/*.test.@(ts|tsx|js|jsx)"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|lucide-react-native|@nkzw/.*|@supabase/.*|@rork-ai/.*))",
  ],
  clearMocks: true,
};
