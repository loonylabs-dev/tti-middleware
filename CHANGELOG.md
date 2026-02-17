# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.1] - 2026-02-17

### Fixed

- **Gemini 3 Pro Image**: Enable `characterConsistency` capability — the model supports up to 14 reference images (5 humans + 6 objects + 3 style refs) but the capability flag was incorrectly set to `false`, causing reference image requests to be rejected during validation.

---

## [1.5.0] - 2026-02-15

### Added

#### Imagen 4 & Gemini 3 Pro Image Support

Added support for four new Google Cloud models, all accessible via Vertex AI:

**Imagen 4 family** (uses same predict API as Imagen 3):
- **`imagen-4`** — Standard Imagen 4 (`imagen-4.0-generate-001`), up to 2816x1536 resolution
- **`imagen-4-fast`** — Faster inference variant (`imagen-4.0-fast-generate-001`), up to 1408x768
- **`imagen-4-ultra`** — Highest quality variant (`imagen-4.0-ultra-generate-001`), up to 2816x1536

**Gemini 3 Pro Image** (uses same generateContent API as Gemini Flash):
- **`gemini-pro-image`** — Gemini 3 Pro Image Preview (`gemini-3-pro-image-preview`), 4K resolution, text rendering
- **Requires `global` endpoint** — regional endpoints (e.g. `europe-west3`) return 404. The middleware handles this automatically.

**Region availability:**
- All Imagen 4 variants are available in all major EU regions including `europe-west3` (Frankfurt)
- Gemini Pro Image requires the `global` Vertex AI endpoint (auto-routed by the middleware)

### Changed

#### API-Type Based Model Routing

Refactored internal model routing from per-model switch cases to API-type based routing (Imagen predict API vs Gemini generateContent API). This makes adding future models trivial — just add a model definition and map it to the correct API type.

#### Per-Region Genai Client Caching

The `@google/genai` Vertex AI client is now cached per region instead of globally. This is necessary because `gemini-flash-image` uses regional endpoints (e.g. `europe-west1`) while `gemini-pro-image` requires the `global` endpoint — both can be used in the same session without conflicts.

**No breaking changes** — external API remains unchanged.

---

## [1.4.1] - 2026-02-13

### Fixed

#### Full Model Response in Error Logs for Gemini "No Images" Failures

When Gemini returns text instead of an image (e.g., refusing due to style/safety constraints), the model's full response text was truncated to 50 characters in both the error message and debug logs, making it impossible to diagnose why image generation was declined.

**Changes:**
- **Error message**: Increased text preview from 50 to 200 characters for readable error propagation
- **Console log**: Added full `modelResponse` field to the structured log output
- **Markdown debug log**: Added `Model Response` field showing the complete untruncated text from Gemini
- **`GenerationFailedError`**: Added optional `modelResponse` property carrying the full model response

**Before:**
```
## Error
- **Message**: No images in response. Model returned: text(I cannot use the provided style instructions and c...).
- **Code**: GENERATION_FAILED
```

**After:**
```
## Error
- **Message**: No images in response. Model returned: text(I cannot use the provided style instructions and character references to generate...).
- **Model Response**: I cannot use the provided style instructions and character references to generate this image because [full reason from Gemini].
- **Code**: GENERATION_FAILED
```

---

## [1.4.0] - 2026-02-12

### Added

#### Per-Attempt Timeout with Independent Retry Budget

Added timeout protection for provider SDK calls that hang indefinitely (e.g., when the Vertex AI API never responds). Timeouts and transient errors (429, 5xx) now have **independent retry counters**, so a hung service doesn't burn through the quota-retry budget.

**New `RetryOptions` fields:**
- `timeoutMs` (default: `45000` = 45s) — per-attempt timeout. If the SDK call doesn't resolve within this time, the attempt is aborted.
- `timeoutRetries` (default: `2`) — max retries specifically for timeout errors. Tracked independently from `maxRetries` (used for 429/5xx).

**Behavior:**
- Timeout errors get a short fixed 2s delay before retry (no exponential backoff).
- Transient errors (429, 5xx) continue to use exponential backoff with `maxRetries`.
- Both budgets are independent — a timeout doesn't consume a general retry, and vice versa.

**Example:**
```typescript
const response = await service.generate({
  prompt: 'A sunset',
  retry: {
    maxRetries: 6,       // 6 retries for quota errors (429)
    timeoutMs: 45000,    // 45s per attempt
    timeoutRetries: 2,   // 2 retries for timeouts
  },
});
```

**Worst-case timing for timeout scenario:** 3 attempts x 45s + 2 x 2s delay = ~2:19 min (then error propagates).

#### Improved Provider Logging

- Upgraded Imagen and Gemini SDK call logging from `debug` to `info` level.
- Added response logging with duration after successful SDK calls.
- Added per-attempt logging in `executeWithRetry` showing attempt number, timeout config, and retry budget status.
- Log output is controllable via `setLogLevel()` or `TTI_LOG_LEVEL` env var.

---

## [1.3.0] - 2026-02-06

### Fixed

#### Aspect Ratio Support for Gemini Flash Image

Fixed a critical bug where the `aspectRatio` parameter was being ignored for `gemini-flash-image` model, always generating 1:1 square images regardless of the requested aspect ratio.

**The Issue:**
- `aspectRatio` parameter (e.g., `"16:9"`) was not being passed to the Gemini API
- Only affected `gemini-flash-image` model (Imagen 3 worked correctly)
- Always resulted in 1024x1024 square images

**The Fix:**
- Added proper `imageConfig` structure to Gemini API calls
- Now correctly passes `aspectRatio` in nested `imageConfig` object:
  ```typescript
  config: {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: {
      aspectRatio: '16:9'  // Now properly sent to API
    }
  }
  ```

**Supported Aspect Ratios:**
All standard ratios are now working: `1:1`, `3:2`, `2:3`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`

**Example:**
```typescript
// Now generates actual 16:9 landscape images
const response = await service.generate({
  prompt: 'A beautiful sunset over mountains',
  model: 'gemini-flash-image',
  aspectRatio: '16:9',  // ✅ Now works!
});
```

### Changed

#### Updated @google/genai SDK Dependency

Upgraded `@google/genai` from `^0.14.0` to `^1.40.0` to resolve known `imageConfig` bugs in older SDK versions.

**Breaking Change Note:**
While this is a major version bump in the peer dependency, no breaking changes were observed in our usage. The minimum peer dependency requirement is now `>=1.40.0`.

**Benefits:**
- Fixes multiple reported `imageConfig` parameter issues
- Improved stability and compatibility
- Better support for image generation features

**Migration:**
Users should update their `@google/genai` dependency:
```bash
npm install @google/genai@^1.40.0
```

### Added

#### New Test Script

Added `scripts/manual-test-aspect-ratio-16-9.ts` for testing aspect ratio functionality:
```bash
npx ts-node scripts/manual-test-aspect-ratio-16-9.ts
```

The script:
- Tests 16:9 aspect ratio generation
- Automatically validates image dimensions
- Provides detailed logging
- Saves generated images to `output/` directory

---

## [1.2.0] - 2026-01-29

### Changed

#### Exponential Backoff with Jitter for Retry Logic

The retry mechanism has been upgraded from simple linear/static retry to **exponential backoff with jitter**, following [Google Cloud best practices](https://cloud.google.com/storage/docs/retry-strategy).

**Before (v1.1.x):**
- Only retried on 429 (rate limit) errors
- Static or linear delay (`1s, 2s, 3s...`)
- No jitter (thundering herd risk)
- No delay cap

**After (v1.2.0):**
- Retries on **all transient errors**: 429, 408, 500, 502, 503, 504
- Retries on **network errors**: timeouts, ECONNRESET, ECONNREFUSED, socket hang up, etc.
- Does NOT retry on client errors: 400, 401, 403
- **Exponential backoff**: `1s → 2s → 4s → 8s → 16s...`
- **Jitter**: randomized delay to prevent thundering herd
- **Max delay cap**: 30s (configurable)

**New defaults:**
```typescript
{
  maxRetries: 3,        // was 2
  delayMs: 1000,        // unchanged
  backoffMultiplier: 2.0, // NEW (was linear)
  maxDelayMs: 30000,    // NEW
  jitter: true,         // NEW
}
```

**New `RetryOptions` fields:**

| Option | Default | Description |
|--------|---------|-------------|
| `maxRetries` | 3 | Maximum retry attempts |
| `delayMs` | 1000 | Base delay between retries (ms) |
| `backoffMultiplier` | 2.0 | Exponential multiplier (`delay * multiplier^attempt`) |
| `maxDelayMs` | 30000 | Maximum delay cap (ms) |
| `jitter` | true | Randomize delay to prevent thundering herd |

**API compatibility:**
- `retry: true` / `retry: false` works unchanged
- `retry: { maxRetries: 5 }` works unchanged (new defaults merge in)
- `incrementalBackoff` is deprecated but still accepted

---

## [1.1.1] - 2026-01-26

### Added

#### Dry Mode for Development & Debugging

New `dry` flag in `TTIRequest` to skip actual API calls while still validating requests and logging to the debug files. Perfect for development and debugging without incurring API costs.

**Usage:**
```typescript
// Dry mode - no API call, no cost
const result = await service.generate({
  prompt: 'A beautiful sunset over mountains',
  model: 'gemini-flash-image',
  dry: true,  // Skip API call
});

// Returns placeholder response:
// {
//   images: [{ base64: '...white 1024x1024 PNG...', contentType: 'image/png' }],
//   metadata: { provider: 'google-cloud', model: 'gemini-flash-image', duration: 0 },
//   usage: { imagesGenerated: 1, modelId: 'gemini-flash-image' }
// }
```

**What happens in dry mode:**
- Request is fully validated (prompt, model, capabilities, reference images)
- Request is logged via TTIDebugger (if enabled with `DEBUG_TTI_REQUESTS=true`)
- No actual API call is made
- Returns placeholder images (white 1024x1024 PNG) - respects `n` parameter for multiple images

**Use cases:**
- Developing prompt templates without API costs
- Testing request validation logic
- Debugging TTIDebugger log output
- CI/CD pipeline validation

#### Multi-Reference Test Script (4 Images)

New test script for validating multi-reference scenarios with 4 different subjects:

```bash
# Generate base images (cowboys, house, horse) + run tests
npx ts-node scripts/manual-test-multi-reference-4-images.ts

# Only generate base images
npx ts-node scripts/manual-test-multi-reference-4-images.ts --generate-base

# Only run combination tests (requires existing images)
npx ts-node scripts/manual-test-multi-reference-4-images.ts --test-only
```

The script compares Raw Mode (index-based, no subjectDescription) vs Template Mode (with subjectDescription) for complex multi-subject scenes.

### Changed

#### Template Wording: "character" → "subject"

The internal character consistency prompt template now uses "subject" instead of "character" for broader applicability. This allows the structured mode to work better with non-character references (objects, buildings, animals, etc.).

**Before:**
```
Using the reference image as a reference for the character "cute bear"...
```

**After:**
```
Using the reference image as a reference for the subject "cute bear"...
```

This is a minor wording change that improves results when using reference images for non-character subjects like houses, vehicles, or other objects.

#### Internal: Provider Architecture Refactoring

Refactored `BaseTTIProvider` to support centralized dry mode handling:
- `generate()` is now a concrete method in `BaseTTIProvider` (handles validation + dry mode)
- New `doGenerate()` abstract method for provider-specific API calls
- All providers (GoogleCloud, EdenAI, IONOS) updated to implement `doGenerate()`
- **No breaking changes** - external API remains unchanged

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
