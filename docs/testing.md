# Testing Guide

This guide covers the testing infrastructure for @loonylabs/tti-middleware.

## Overview

The middleware uses a two-tier testing approach:

| Type | Purpose | API Calls | Default |
|------|---------|-----------|---------|
| **Unit Tests** | Test logic, validation, error handling | No | Enabled |
| **Integration Tests** | Test real API behavior | Yes | Disabled |

## Quick Reference

```bash
# Unit tests
npm run test:unit              # Run unit tests
npm run test:unit:watch        # Watch mode
npm run test:unit:coverage     # With coverage report

# Integration tests (requires setup)
npm run test:integration       # Run integration tests

# All tests
npm test                       # Unit + integration (if enabled)

# CI/CD
npm run test:ci                # Unit tests, in band, with coverage

# Manual testing
npm run test:manual:google-cloud
```

## Unit Tests

### Coverage

- **123 tests** across 4 test files
- **>95% coverage** on tested code
- Runs without API calls or credentials

### Test Files

| File | Description |
|------|-------------|
| `tests/unit/providers/base-tti-provider.test.ts` | Error classes, retry logic, validation |
| `tests/unit/providers/google-cloud-provider.test.ts` | Config, models, regions, compliance |
| `tests/unit/services/tti-service.test.ts` | Service orchestration, provider management |
| `tests/unit/types/types.test.ts` | Type exports, DEFAULT_RETRY_OPTIONS |

### Running Unit Tests

```bash
# Basic run
npm run test:unit

# With watch mode (re-runs on file changes)
npm run test:unit:watch

# With coverage report
npm run test:unit:coverage
```

### Coverage Report

After running with coverage:

```
-----------------------|---------|----------|---------|---------|
File                   | % Stmts | % Branch | % Funcs | % Lines |
-----------------------|---------|----------|---------|---------|
All files              |   96.42 |   81.81  |   97.14 |   96.15 |
 types/index.ts        |   100   |   100    |   100   |   100   |
 services/tti/...      |   95.83 |   80.00  |   96.55 |   95.45 |
```

### Excluded from Coverage

These provider files are excluded from coverage (require real API calls):

- `edenai-provider.ts`
- `ionos-provider.ts`
- `google-cloud-provider.ts`

These are tested via integration tests.

## Integration Tests

### Purpose

Integration tests verify:
- Real API connections
- Actual image generation
- Region fallback behavior
- Character consistency
- Rate limiting and retry

### Prerequisites

1. **Google Cloud Project** with Vertex AI enabled
2. **Service Account** with Vertex AI permissions
3. **Environment Variables**:

```bash
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

### Enabling Integration Tests

Integration tests are **disabled by default** to prevent accidental API costs.

Enable with environment variable:

```bash
# Windows (PowerShell)
$env:TTI_INTEGRATION_TESTS="true"
npm run test:integration

# Windows (CMD)
set TTI_INTEGRATION_TESTS=true && npm run test:integration

# Linux/macOS
TTI_INTEGRATION_TESTS=true npm run test:integration

# Using cross-env (included in devDependencies)
npx cross-env TTI_INTEGRATION_TESTS=true npm run test:integration
```

### Test File

`tests/integration/google-cloud.integration.test.ts`

### What's Tested

| Test | Model | Description |
|------|-------|-------------|
| Simple Image | imagen-3 | Basic text-to-image |
| 16:9 Aspect | imagen-3 | Aspect ratio support |
| Simple Image | gemini-flash | Text-to-image with Gemini |
| Region Fallback | gemini-flash | europe-west3 fallback |
| Character Create | gemini-flash | Create reference character |
| Character Consistency | gemini-flash | Same character in new scene |
| Retry Logic | gemini-flash | Rate limit handling |
| Compliance | - | Compliance info validation |

### Expected Behavior

- **Success**: 6-8 tests pass
- **Rate Limits**: Some tests may fail with 429 errors (this is expected under heavy load)
- **Duration**: 60-120 seconds total (real API calls)

### Timeouts

- Standard tests: 60 seconds (`TTI_TIMEOUT`)
- Character consistency: 120 seconds (`TTI_EXTENDED_TIMEOUT`)

## Test Helpers

### describeLive / itLive

Conditional test execution:

```typescript
import { describeLive, itLive } from './helpers/live-tti-test-helper';

describeLive('My Integration Tests', () => {
  itLive('should generate an image', async () => {
    // Only runs if TTI_INTEGRATION_TESTS=true
  });
});
```

### Request Builders

```typescript
import {
  buildLiveTestRequest,
  buildCharacterConsistencyRequest,
} from './helpers/live-tti-test-helper';

// Simple request
const request = buildLiveTestRequest({
  prompt: 'A red circle',
  model: 'imagen-3',
});

// Character consistency request
const request = buildCharacterConsistencyRequest({
  prompt: 'dancing in the rain',
  referenceBase64: previousImage,
  subjectDescription: 'cartoon bear',
});
```

### Validation

```typescript
import {
  validateImageResponse,
  isValidBase64Image,
} from './helpers/live-tti-test-helper';

expect(validateImageResponse(response)).toBe(true);
expect(isValidBase64Image(response.images[0].base64)).toBe(true);
```

## Manual Testing

For quick manual tests during development:

```bash
# Google Cloud provider
npm run test:manual:google-cloud

# Eden AI provider
npm run test:manual
```

These scripts generate actual images and save them to disk.

## CI/CD

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:ci

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

### Integration Tests in CI

Integration tests require secrets:

```yaml
  integration-test:
    runs-on: ubuntu-latest
    if: github.event_name == 'workflow_dispatch'

    steps:
      - uses: actions/checkout@v4

      - name: Setup credentials
        run: echo '${{ secrets.GCP_SERVICE_ACCOUNT }}' > sa.json

      - name: Run integration tests
        env:
          GOOGLE_CLOUD_PROJECT: ${{ secrets.GCP_PROJECT }}
          GOOGLE_APPLICATION_CREDENTIALS: ./sa.json
          TTI_INTEGRATION_TESTS: true
        run: npm run test:integration
```

## Writing Tests

### Unit Test Example

```typescript
describe('MyFeature', () => {
  it('should validate input', () => {
    const provider = new GoogleCloudTTIProvider();

    expect(() => provider.validateRequest({} as TTIRequest))
      .toThrow(InvalidConfigError);
  });
});
```

### Integration Test Example

```typescript
import { describeLive, itLive, TTI_TIMEOUT } from './helpers/live-tti-test-helper';

describeLive('MyFeature Integration', () => {
  itLive('should generate image', async () => {
    const service = new TTIService();
    service.registerProvider(new GoogleCloudTTIProvider());

    const response = await service.generate({
      prompt: 'A test image',
      model: 'imagen-3',
    });

    expect(response.images.length).toBeGreaterThan(0);
  }, TTI_TIMEOUT);
});
```

## Troubleshooting

### Tests Timeout

Increase the timeout or check your network:

```typescript
itLive('slow test', async () => {
  // ...
}, 120000); // 2 minutes
```

### Rate Limit Errors

Expected during integration tests. The middleware retries automatically, but under heavy load some tests may still fail.

### Missing Credentials

```
Error: Google Cloud Project ID is required
```

Set environment variables:

```bash
export GOOGLE_CLOUD_PROJECT=your-project
export GOOGLE_APPLICATION_CREDENTIALS=./sa.json
```

### Wrong Region

```
Error: Model gemini-flash-image not available in europe-west3
```

This is handled automatically - the test should still pass with region fallback.

## See Also

- [Getting Started](getting-started.md)
- [Google Cloud Provider](providers/google-cloud.md)
- [Compliance](compliance.md)
