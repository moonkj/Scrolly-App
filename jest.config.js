module.exports = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['./tests/setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 10000,
  collectCoverageFrom: [
    'ios/SafariExtension/Resources/content.js',
    'ios/SafariExtension/Resources/popup.js',
    'ios/SafariExtension/Resources/background.js',
  ],
  coverageProvider: 'v8',
  coverageReporters: ['text', 'lcov'],
};
