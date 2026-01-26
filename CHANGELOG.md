# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-01-26

### ✨ Added

#### Markdown Debug Logging (TTIDebugger)

New debugging utility that logs all TTI requests and responses to markdown files, similar to the LLM middleware logging system. Perfect for debugging character consistency issues.

**Enable via environment variable:**
```bash
DEBUG_TTI_REQUESTS=true
```

**Or programmatically:**
```typescript
import { TTIDebugger } from '@loonylabs/tti-middleware';

TTIDebugger.setEnabled(true);
TTIDebugger.setLogsDir('/path/to/logs/tti/requests');
```

**What gets logged:**
- Full prompt text
- Subject description (critical for character consistency debugging)
- Reference image metadata (count, mime types, base64 length)
- Provider, model, and region
- Response metadata (duration, image count)
- Errors with full details

**Log file format:**
```
logs/tti/requests/
└── 2026-01-26T12-34-56-789Z_generate-section-image_char-abc123.md
```

**Configuration options:**
```typescript
TTIDebugger.configure({
  enabled: true,                    // Enable/disable logging
  logsDir: './logs/tti/requests',   // Custom log directory
  consoleLog: true,                 // Also log to console
  includeBase64: false,             // Include full base64 in logs (default: false)
});
```

#### Index-Based Character Referencing (Multi-Character Support)

New mode for character consistency that allows referencing multiple distinct characters in a single scene by their position in the `referenceImages` array.

**Before (Structured Mode - still supported):**
```typescript
// Single character with subjectDescription
await service.generate({
  prompt: 'dancing in the rain',
  model: 'gemini-flash-image',
  referenceImages: [{ base64: bearImage }],
  subjectDescription: 'cute cartoon bear',  // Required
});
```

**New (Index-Based Mode):**
```typescript
// Multiple characters referenced by position
await service.generate({
  prompt: `The character on the LEFT should look like the FIRST reference image.
           The character on the RIGHT should look like the SECOND reference image.`,
  model: 'gemini-flash-image',
  referenceImages: [
    { base64: cowboy1, mimeType: 'image/png' },
    { base64: cowboy2, mimeType: 'image/png' },
  ],
  // subjectDescription omitted = Index-Based Mode
});
```

**Mode Comparison:**

| Feature | Structured Mode | Index-Based Mode |
|---------|-----------------|------------------|
| `subjectDescription` | Required | Omitted |
| Best for | Single character across scenes | Multiple characters in one scene |
| Reference style | Auto-generated template | Manual in prompt |

### 🔧 Changed

- **Validation relaxed**: `subjectDescription` is now optional when using `referenceImages`
- Previous behavior (requiring `subjectDescription`) still works unchanged

### 📝 Documentation

- Updated README with both character consistency modes
- Updated `docs/getting-started.md` with index-based mode examples
- Updated `docs/providers/google-cloud.md` with detailed mode comparison
- Updated `CLAUDE.md` for AI assistants

### 🧪 Tests

- Updated unit tests to reflect new validation behavior
- Added test for index-based mode validation

---

## [1.0.0] - 2026-01-21

First stable release. No changes from 0.1.0.

---

## [0.1.0] - 2026-01-21

### 🚀 Initial Release

Provider-agnostic Text-to-Image middleware with **GDPR/DSGVO compliance** and **character consistency** support.

### ✨ Features

#### Provider Architecture (Refactored)
- **Provider = Backend = Vertragspartner = Eine DPA**
  - Clean separation: One provider represents one backend with one Data Processing Agreement
  - `GoogleCloudTTIProvider` - Google Cloud Platform (Vertex AI) - Imagen 3 + Gemini Flash Image
  - `EdenAIProvider` - Eden AI aggregator (integration tests only)
  - `IonosProvider` - IONOS Cloud (integration tests only)

#### Google Cloud Provider
- **Imagen 3** (`imagen-3`) - High-quality text-to-image generation
  - Available in all EU regions (europe-west1, europe-west3, europe-west4, europe-west9, europe-north1)
  - Uses `@google-cloud/aiplatform` SDK
  - Up to 4 images per request
- **Gemini 2.5 Flash Image** (`gemini-flash-image`) - Character consistency support
  - Uses `@google/genai` SDK with Vertex AI backend
  - Available in: `europe-west1`, `europe-west4`, `europe-north1`
  - ⚠️ **NOT available in `europe-west3` (Frankfurt)** - Automatic fallback to available EU region
  - Built-in character consistency via reference images

#### Character Consistency
- Generate consistent characters across multiple images
- Perfect for children's book illustrations
- Uses `referenceImages` and `subjectDescription` in TTIRequest
- Only supported by `gemini-flash-image` model

```typescript
// Create character
const bear = await service.generate({
  prompt: 'A cute cartoon bear with red hat and blue scarf',
  model: 'gemini-flash-image',
});

// Reuse in new scene
const dancingBear = await service.generate({
  prompt: 'dancing happily in the rain',
  model: 'gemini-flash-image',
  referenceImages: [{ base64: bear.images[0].base64 }],
  subjectDescription: 'cute cartoon bear with red hat and blue scarf',
});
```

#### Retry Logic
- **Default**: 2 retries with 1s delay
- **Configurable** via `RetryOptions`:
  ```typescript
  retry: {
    maxRetries: 3,
    delayMs: 2000,
    incrementalBackoff: true  // 1s, 2s, 3s...
  }
  ```
- **Deactivatable**: `retry: false`
- **Only triggers on**: Rate limit errors (429, "quota exceeded", "too many requests", "resource exhausted")

#### EU Region Support
- Helper methods for EU compliance checks:
  - `isEURegion()`: Check if using an EU region
  - `getRegion()`: Get the configured region
- Compliance information provided in documentation only (see [docs/compliance.md](docs/compliance.md))

#### Type Safety
- Full TypeScript support
- Comprehensive type definitions:
  - `TTIRequest`, `TTIResponse`, `TTIImage`
  - `ModelInfo`, `TTICapabilities`
  - `RetryOptions`, `TTIUsage`, `TTIBilling`
  - `TTIProvider` enum, `GoogleCloudRegion` type

### 🧪 Testing Infrastructure

#### Unit Tests (123 tests, >95% coverage)
- `tests/unit/providers/base-tti-provider.test.ts` - Error classes, retry logic, validation
- `tests/unit/providers/google-cloud-provider.test.ts` - Config, models, regions, compliance
- `tests/unit/services/tti-service.test.ts` - Service orchestration
- `tests/unit/types/types.test.ts` - Type exports

#### Integration Tests (Live API)
- `tests/integration/google-cloud.integration.test.ts` - Live API tests
- Uses `describeLive`/`itLive` pattern (skipped by default)
- Enable with: `TTI_INTEGRATION_TESTS=true npm run test:integration`
- Tests include: Imagen 3, Gemini Flash Image, Character Consistency, Region Fallback

#### Test Commands
```bash
npm run test:unit          # Unit tests only
npm run test:unit:watch    # Watch mode
npm run test:unit:coverage # With coverage report
npm run test:integration   # Live API tests (requires env vars)
npm run test:ci            # CI/CD (unit tests only)
```

### 📦 Dependencies

#### Peer Dependencies (optional)
- `@google-cloud/aiplatform` >= 3.0.0 (for Imagen 3)
- `@google/genai` >= 0.14.0 (for Gemini Flash Image)

#### Dev Dependencies
- `jest` + `ts-jest` for testing
- `cross-env` for cross-platform env vars
- `dotenv` for environment configuration

### 📁 Project Structure

```
src/
├── middleware/
│   ├── types/
│   │   └── index.ts              # All type definitions
│   └── services/
│       └── tti/
│           ├── tti.service.ts    # Service orchestrator
│           └── providers/
│               ├── index.ts
│               ├── base-tti-provider.ts   # Abstract base, error classes, retry
│               ├── google-cloud-provider.ts
│               ├── edenai-provider.ts
│               └── ionos-provider.ts
tests/
├── unit/                         # 123 unit tests
├── integration/                  # Live API tests
│   └── helpers/
│       └── live-tti-test-helper.ts
├── fixtures/                     # Test data
└── setup.ts                      # Jest setup (dotenv)
```

### 🔧 Configuration

#### Environment Variables
```bash
# Default provider
TTI_DEFAULT_PROVIDER=google-cloud

# Google Cloud (recommended for EU)
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GOOGLE_CLOUD_REGION=europe-west4  # Recommended (supports all models)

# Eden AI
EDENAI_API_KEY=your-api-key

# IONOS
IONOS_API_KEY=your-api-key
IONOS_API_URL=https://api.ionos.cloud/ai/v1
```

### ⚠️ Known Limitations

- **Eden AI Provider**: Not unit tested (integration tests only)
- **IONOS Provider**: Not unit tested (integration tests only)
- **Imagen 3 Character Consistency**: Requires Google allowlist (Customization API not publicly available)
- **Gemini Flash Image in Frankfurt**: Model not available in `europe-west3`, automatic fallback to other EU regions

### 📚 Documentation

- [README.md](README.md) - Quick start and overview
- [docs/getting-started.md](docs/getting-started.md) - Detailed setup guide
- [docs/providers/google-cloud.md](docs/providers/google-cloud.md) - Google Cloud specifics
- [docs/compliance.md](docs/compliance.md) - GDPR/DPA information
- [docs/testing.md](docs/testing.md) - Testing guide

---

## Compatibility

### Node.js
- **Minimum**: 18.0.0
- **Recommended**: 20.x or later

### TypeScript
- **Minimum**: 5.0.0
- **Recommended**: 5.3.x or later

---

## Links

- [GitHub Repository](https://github.com/loonylabs-dev/tti-middleware)
- [Documentation](docs/)
- [Issues](https://github.com/loonylabs-dev/tti-middleware/issues)
