/**
 * Jest Configuration for TTI Middleware
 *
 * Following the same patterns as @loonylabs/llm-middleware
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Test file locations
  roots: ['<rootDir>/tests'],
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts',
  ],

  // TypeScript transformation
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.interface.ts',
    '!src/**/*.type.ts',
    '!src/**/index.ts',
    // Exclude provider implementations that require integration tests (real API calls)
    // These are tested via:
    //   - TTI_INTEGRATION_TESTS=true npm run test:integration
    //   - npm run test:manual:google-cloud
    // Only GoogleCloudTTIProvider has unit tests for config/validation
    // EdenAI and IONOS providers are NOT unit tested (integration tests only)
    '!src/middleware/services/tti/providers/edenai-provider.ts',
    '!src/middleware/services/tti/providers/ionos-provider.ts',
    '!src/middleware/services/tti/providers/google-cloud-provider.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'html', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },

  // Module resolution
  moduleFileExtensions: ['ts', 'js', 'json'],

  // Setup files (load .env for integration tests)
  setupFiles: ['<rootDir>/tests/setup.ts'],

  // Test timeout (useful for async operations)
  testTimeout: 10000,

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,
};
