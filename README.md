<div align="center">

# TTI Middleware

*Provider-agnostic Text-to-Image middleware with **GDPR compliance** and **character consistency** support. Currently supports Google Cloud (Imagen 3, Imagen 4, Gemini Flash Image, Gemini 3 Pro Image), Black Forest Labs (FLUX), Eden AI, and IONOS. Features EU data residency (Vertex AI + the BFL EU endpoint), automatic region fallback, retry logic, and comprehensive error handling.*

<!-- Horizontal Badge Navigation Bar -->
[![npm version](https://img.shields.io/npm/v/@loonylabs/tti-middleware.svg?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@loonylabs/tti-middleware)
[![npm downloads](https://img.shields.io/npm/dm/@loonylabs/tti-middleware.svg?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@loonylabs/tti-middleware)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg?style=for-the-badge&logo=typescript&logoColor=white)](#-features)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](#-prerequisites)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge&logo=opensource&logoColor=white)](#-license)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/loonylabs-dev/tti-middleware)

</div>

<!-- Table of Contents -->
<details>
<summary><strong>Table of Contents</strong></summary>

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Prerequisites](#-prerequisites)
- [Configuration](#%EF%B8%8F-configuration)
- [Providers & Models](#-providers--models)
- [Character Consistency](#-character-consistency)
- [Inpainting / Image Editing](#inpainting--image-editing)
- [GDPR / Compliance](#-gdpr--compliance)
- [API Reference](#-api-reference)
- [Advanced Features](#-advanced-features)
- [Testing](#-testing)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [License](#-license)
- [Links](#-links)

</details>

---

## Features

- **Multi-Provider Architecture**: Unified API for all TTI providers
  - **Google Cloud** (Recommended): Imagen 3, Imagen 4, Gemini Flash Image & Gemini 3 Pro Image with EU data residency
  - **Black Forest Labs (FLUX)**: FLUX1.1 pro, FLUX.1 Kontext pro, FLUX.2 pro via the EU endpoint (GDPR / EU data residency)
  - **Eden AI**: Aggregator with access to OpenAI, Stability AI, Replicate (experimental)
  - **IONOS**: German cloud provider with OpenAI-compatible API (experimental)
- **Character Consistency**: Generate consistent characters across multiple images (perfect for children's book illustrations)
- **Inpainting**: Fix specific areas of a generated image without regenerating the entire scene — via Vertex AI `imagen-capability` model.
- **GDPR/DSGVO Compliance**: Built-in EU region support with automatic fallback
- **Region Rotation**: Opt-in region rotation on quota errors (429) for Google Cloud — rotate through regions instead of retrying the same exhausted region
- **Retry Logic**: Exponential backoff with jitter for transient errors (429, 408, 5xx, timeouts)
- **TypeScript First**: Full type safety with comprehensive interfaces
- **Logging Control**: Configurable log levels via environment or API
- **Debug Logging**: Markdown file logging for debugging prompts and responses
- **Error Handling**: Typed error classes for precise error handling

## Quick Start

### Installation

Install from npm:

```bash
npm install @loonylabs/tti-middleware

# For Google Cloud provider (recommended):
npm install @google-cloud/aiplatform @google/genai
```

Or install directly from GitHub:

```bash
npm install github:loonylabs-dev/tti-middleware
```

### Basic Usage

```typescript
import { TTIService, GoogleCloudTTIProvider, TTIProvider } from '@loonylabs/tti-middleware';

// Create service and register provider
const service = new TTIService();
service.registerProvider(new GoogleCloudTTIProvider({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  region: 'europe-west4', // EU region for GDPR
}));

// Generate an image
const result = await service.generate({
  prompt: 'A futuristic city with flying cars, cyberpunk style',
  model: 'imagen-3',
});

console.log('Image generated:', result.images[0].base64?.substring(0, 50) + '...');
console.log('Duration:', result.metadata.duration, 'ms');
```

<details>
<summary><strong>Using Character Consistency</strong></summary>

Generate consistent characters across multiple images:

```typescript
// 1. Create the initial character
const character = await service.generate({
  prompt: 'A cute cartoon bear with a red hat and blue scarf, watercolor style',
  model: 'gemini-flash-image', // Only this model supports character consistency!
});

// 2. Generate new scenes with the same character (Structured Mode)
const scene = await service.generate({
  prompt: 'dancing happily in the rain, jumping in puddles',
  model: 'gemini-flash-image',
  referenceImages: [{
    base64: character.images[0].base64!,
    mimeType: 'image/png',
  }],
  subjectDescription: 'cute cartoon bear with red hat and blue scarf',
});

// 3. Or use Index-Based Mode for multiple characters
const multiCharScene = await service.generate({
  prompt: 'The FIRST reference image character meets the SECOND reference image character',
  model: 'gemini-flash-image',
  referenceImages: [
    { base64: character1.images[0].base64!, mimeType: 'image/png' },
    { base64: character2.images[0].base64!, mimeType: 'image/png' },
  ],
  // subjectDescription omitted = Index-Based Mode
});
```

**Important:** Character consistency is only supported by `gemini-flash-image` model!

</details>

<details>
<summary><strong>Switching Providers</strong></summary>

```typescript
// Use Google Cloud (recommended for EU)
const googleResult = await service.generate({
  prompt: 'A mountain landscape',
  model: 'imagen-3',
}, TTIProvider.GOOGLE_CLOUD);

// Use Eden AI (experimental)
const edenResult = await service.generate({
  prompt: 'A mountain landscape',
  model: 'openai', // Uses DALL-E via Eden AI
}, TTIProvider.EDENAI);

// Use Black Forest Labs / FLUX (EU endpoint, GDPR)
const fluxResult = await service.generate({
  prompt: 'A mountain landscape',
  model: 'flux-1.1-pro',
}, TTIProvider.BFL);

// Use IONOS (experimental)
const ionosResult = await service.generate({
  prompt: 'A mountain landscape',
}, TTIProvider.IONOS);
```

</details>

## Prerequisites

<details>
<summary><strong>Required Dependencies</strong></summary>

- **Node.js** 18+
- **TypeScript** 5.3+
- **Google Cloud SDK** (optional, for Google Cloud provider)

For Google Cloud provider:
```bash
npm install @google-cloud/aiplatform @google/genai
```

</details>

## Configuration

<details>
<summary><strong>Environment Setup</strong></summary>

Create a `.env` file in your project root:

```env
# Default provider
TTI_DEFAULT_PROVIDER=google-cloud

# Logging level (debug, info, warn, error, silent)
TTI_LOG_LEVEL=info

# Google Cloud (recommended for EU/GDPR)
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GOOGLE_CLOUD_REGION=europe-west4  # Recommended for Gemini

# Black Forest Labs / FLUX (EU endpoint, GDPR)
BFL_API_KEY=your-api-key
BFL_API_URL=https://api.eu.bfl.ai  # Default; do not change if EU residency is required

# Eden AI (experimental)
EDENAI_API_KEY=your-api-key

# IONOS (experimental)
IONOS_API_KEY=your-api-key
IONOS_API_URL=https://api.ionos.cloud/ai/v1
```

</details>

## Providers & Models

### Google Cloud (Recommended)

| Model | ID | Character Consistency | EU Regions | Max Images |
|-------|-----|----------------------|------------|------------|
| **Imagen 3** | `imagen-3` | No | All EU regions | 4 |
| **Imagen 4** | `imagen-4` | No | All EU regions | 4 |
| **Imagen 4 Fast** | `imagen-4-fast` | No | All EU regions | 4 |
| **Imagen 4 Ultra** | `imagen-4-ultra` | No | All EU regions | 4 |
| **Gemini Flash Image** | `gemini-flash-image` | **Yes** | europe-west1, europe-west4, europe-north1 | 1 |
| **Gemini 3 Pro Image** | `gemini-pro-image` | No | `global` endpoint (auto-routed) | 1 |

**Important:**
- `gemini-flash-image` is **NOT available** in `europe-west3` (Frankfurt) - auto-fallback to EU alternative
- `gemini-pro-image` requires the **`global` Vertex AI endpoint** - the middleware handles this automatically

### Black Forest Labs (FLUX)

FLUX models via the **EU endpoint** (`api.eu.bfl.ai`) for GDPR / EU data residency. BFL is a German company (Freiburg) holding SOC 2 Type II and ISO 27001.

| Model | ID | Character Consistency / Editing | Reference Images | Max Images |
|-------|-----|--------------------------------|------------------|------------|
| **FLUX1.1 [pro]** | `flux-1.1-pro` (default) | No | – | 4* |
| **FLUX.1 Kontext [pro]** | `flux-kontext-pro` | **Yes** (prompt-based, via reference) | 1 | 1 |
| **FLUX.2 [pro]** | `flux-2-pro` | **Yes** (multi-reference) | up to 8 | 1 |

*BFL returns one image per request; `n > 1` fans out into `n` parallel requests.

**Important:**
- The provider is **asynchronous** under the hood (submit → poll → download) but exposed through the normal `generate()` flow.
- Delivery URLs **expire after 10 minutes** — the provider downloads and returns base64 by default. Set `providerOptions.returnUrls = true` to keep the raw URL.
- FLUX does **not** support mask-based inpainting; editing is prompt-based via `referenceImages`.
- **Reference images are generic.** The same `referenceImages` field drives both **character consistency** (*"keep the character from the reference"*) and **style transfer** (*"a new subject in the same art style as the reference"*) — the prompt decides which. No separate field or model is needed.
- **Same two modes as Google Cloud**: provide `subjectDescription` for *structured mode* (the middleware adds the consistency template), or omit it for *index-based mode* (your prompt is sent verbatim).
- Why direct (not Azure/Bedrock): FLUX over Azure is Global Standard only (no EU data zone), and Bedrock FLUX is primarily US-region — only the BFL EU endpoint guarantees EU data residency.

```typescript
service.registerProvider(new BflProvider()); // reads BFL_API_KEY

// Character consistency with FLUX.1 Kontext (index-based mode)
const edited = await service.generate({
  model: 'flux-kontext-pro',
  prompt: 'Change the background to a sunny park, keep the character identical',
  referenceImages: [{ base64: characterBase64 }],
  aspectRatio: '1:1',
  providerOptions: { outputFormat: 'png' },
}, TTIProvider.BFL);

// Style transfer — SAME mechanism, the prompt asks for the style not the subject
const styled = await service.generate({
  model: 'flux-kontext-pro',
  prompt: 'A coffee cup and a book, in the exact same art style as the reference image',
  referenceImages: [{ base64: styleReferenceBase64 }],
}, TTIProvider.BFL);
```

### Eden AI (Experimental)

| Model | ID | Notes |
|-------|-----|-------|
| OpenAI DALL-E | `openai` | Via Eden AI aggregator |
| Stability AI | `stabilityai` | Via Eden AI aggregator |
| Replicate | `replicate` | Via Eden AI aggregator |

### IONOS (Experimental)

| Model | ID | Notes |
|-------|-----|-------|
| Default | `default` | OpenAI-compatible API |

### Google Cloud Region Availability

| Region | Location | Imagen 3 | Imagen 4 | Gemini Flash Image | Gemini Pro Image |
|--------|----------|----------|----------|-------------------|-----------------|
| `europe-west1` | Belgium | Yes | Yes | Yes | `global` endpoint |
| `europe-west3` | Frankfurt | Yes | Yes | **No** | `global` endpoint |
| `europe-west4` | Netherlands | Yes | Yes | **Yes (Recommended)** | `global` endpoint |
| `europe-north1` | Finland | Yes | Yes | Yes | `global` endpoint |
| `europe-west9` | Paris | Yes | Yes | No | `global` endpoint |

## Character Consistency

Generate consistent characters across multiple images - perfect for children's book illustrations.

### Mode 1: Structured Mode (Single Character)

Best for scenes with a single consistent character:

```typescript
// Step 1: Create a character
const bear = await service.generate({
  prompt: 'A cute cartoon bear with a red hat, watercolor style',
  model: 'gemini-flash-image',
});

// Step 2: Use in different scenes
const scenes = ['playing in the park', 'reading a book', 'eating honey'];

for (const scene of scenes) {
  const result = await service.generate({
    prompt: scene,
    model: 'gemini-flash-image',
    referenceImages: [{ base64: bear.images[0].base64!, mimeType: 'image/png' }],
    subjectDescription: 'cute cartoon bear with red hat',  // Required in structured mode
  });
  // Save result...
}
```

### Mode 2: Index-Based Mode (Multiple Characters)

Best for scenes with multiple distinct characters. Reference images directly in your prompt by their position:

```typescript
// Load two different character references
const cowboy1 = await loadImage('cowboy1.png');
const cowboy2 = await loadImage('cowboy2.png');

// Reference each image by index in the prompt
const duelScene = await service.generate({
  prompt: `Generate a cinematic wide shot of a western duel.
    - The character on the LEFT should look exactly like the person in the FIRST reference image.
    - The character on the RIGHT should look exactly like the person in the SECOND reference image.
    They are standing in a dusty street at high noon.`,
  model: 'gemini-flash-image',
  referenceImages: [
    { base64: cowboy1, mimeType: 'image/png' },
    { base64: cowboy2, mimeType: 'image/png' },
  ],
  // subjectDescription intentionally omitted for index-based mode
  aspectRatio: '16:9',
});
```

**Reference keywords:** Use "FIRST reference image", "SECOND reference image" or "Image 1", "Image 2" etc.

### Requirements

| Mode | `subjectDescription` | Use Case |
|------|---------------------|----------|
| **Structured** | Required | Single character across scenes |
| **Index-Based** | Omitted | Multiple characters in one scene |

- For Google Cloud, the model must be `gemini-flash-image`. The BFL provider also supports both modes on `flux-kontext-pro` / `flux-2-pro` (see [Black Forest Labs](#black-forest-labs-flux)).

## Inpainting / Image Editing

The `imagen-capability` model supports mask-based inpainting via Vertex AI. This is the **only** model that supports pixel-precise editing with a mask image.

### Basic Inpainting

```typescript
const result = await service.generate({
  model: 'imagen-capability',
  prompt: 'Remove the extra arm and fill with matching forest background',
  baseImage: { base64: originalImageBase64, mimeType: 'image/png' },
  maskImage: { base64: maskBase64,          mimeType: 'image/png' },
  editMode: 'inpainting-remove',  // default: 'inpainting-insert'
  maskDilation: 0.02,             // optional, 0.0–1.0, default 0.01
});
```

**How the mask works:**
- White pixels = area the model will regenerate
- Black pixels = area preserved exactly as-is
- Mask must have identical dimensions to `baseImage`

### Supported `editMode` Values

| Value | Description |
|-------|-------------|
| `'inpainting-insert'` | Add or replace content in masked area (default) |
| `'inpainting-remove'` | Remove content and fill with matching background |
| `'background-swap'` | Replace background, preserve foreground |
| `'outpainting'` | Extend image beyond its boundaries into the masked area |

## GDPR / Compliance

### Provider Compliance Overview

| Provider | DPA | GDPR | EU Data Residency | Document |
|----------|-----|------|-------------------|----------|
| **Google Cloud** | Yes | Yes | Yes | [CDPA](https://cloud.google.com/terms/data-processing-addendum) |
| **Black Forest Labs (FLUX)** | Yes | Yes | Yes (EU endpoint) | [BFL Legal](https://bfl.ai/legal/terms-of-service) |
| **Eden AI** | Yes | Depends* | Depends* | [Privacy Policy](https://www.edenai.co/privacy-policy) |
| **IONOS** | Yes | Yes | Yes | [AGB](https://cloud.ionos.de/agb) |

*Eden AI is an aggregator - compliance depends on the underlying provider.

**Black Forest Labs:** EU data residency requires the EU endpoint (`api.eu.bfl.ai`, the provider default). Holds SOC 2 Type II and ISO 27001. Note that FLUX accessed via Azure AI Foundry (Global Standard only) or AWS Bedrock (primarily US-region) does **not** guarantee EU data residency.

### Google Cloud Data Usage

- Customer data is **NOT used for training** AI models
- Data stays in configured region (e.g., `europe-west4`)
- Zero data retention option available
- [Vertex AI Privacy Whitepaper](https://services.google.com/fh/files/misc/genai_privacy_google_cloud_202308.pdf)

<details>
<summary><strong>Checking EU Region Status</strong></summary>

```typescript
import { GoogleCloudTTIProvider } from '@loonylabs/tti-middleware';

const provider = new GoogleCloudTTIProvider({
  projectId: 'my-project',
  region: 'europe-west4',
});

console.log('Is EU region:', provider.isEURegion()); // true
console.log('Current region:', provider.getRegion()); // 'europe-west4'
```

</details>

## API Reference

### TTIService

```typescript
class TTIService {
  registerProvider(provider: BaseTTIProvider): void;
  generate(request: TTIRequest, provider?: TTIProvider): Promise<TTIResponse>;
  getProvider(name: TTIProvider): BaseTTIProvider | undefined;
  listAllModels(): Array<{ provider: TTIProvider; models: ModelInfo[] }>;
}
```

### TTIRequest

```typescript
interface TTIRequest {
  prompt: string;
  model?: string;           // 'imagen-3', 'imagen-4', 'gemini-flash-image', 'flux-1.1-pro', 'flux-kontext-pro', etc.
  n?: number;               // Number of images (default: 1)
  aspectRatio?: string;     // '1:1', '16:9', '4:3', etc.

  // Character consistency (Gemini models only)
  referenceImages?: TTIReferenceImage[];
  subjectDescription?: string;

  // Inpainting / image editing (imagen-capability only)
  baseImage?: TTIReferenceImage;   // Activates edit mode when set
  maskImage?: TTIReferenceImage;   // Required when baseImage is set
  maskDilation?: number;           // 0.0–1.0, default 0.01
  editMode?: 'inpainting-insert' | 'inpainting-remove' | 'background-swap' | 'outpainting';

  // Retry configuration
  retry?: boolean | RetryOptions;  // true (default), false, or custom config

  providerOptions?: Record<string, unknown>;
}
```

### TTIResponse

```typescript
interface TTIResponse {
  images: TTIImage[];
  metadata: {
    provider: string;
    model: string;
    region?: string;
    duration: number;
  };
  usage: {
    imagesGenerated: number;
    modelId: string;
  };
  billing?: {          // Only if provider returns costs
    cost: number;
    currency: string;
    source: 'provider' | 'estimated';
  };
}
```

## Advanced Features

<details>
<summary><strong>Region Rotation (Google Cloud)</strong></summary>

When Vertex AI returns 429 (Resource Exhausted) due to Dynamic Shared Quota, the middleware can rotate through a list of regions instead of retrying the same exhausted region:

```typescript
const provider = new GoogleCloudTTIProvider({
  projectId: 'my-project',
  region: 'europe-west4',
  regionRotation: {
    regions: ['europe-west4', 'europe-west1', 'europe-north1', 'europe-central2'],
    fallback: 'global',
    alwaysTryFallback: true, // Default: one bonus attempt on fallback after budget exhausted
  },
});
```

**Key behavior:**
- `maxRetries` is the **total budget** across all regions (no multiplier)
- Only **quota errors** (429, Resource Exhausted) trigger rotation — server errors (500, 503) retry the same region
- `alwaysTryFallback: true` (default): one bonus attempt on fallback even if retry budget is exhausted
- Without `regionRotation`: existing behavior unchanged

</details>

<details>
<summary><strong>Retry Configuration</strong></summary>

Automatic retry with **exponential backoff and jitter** for transient errors (429, 408, 5xx, network timeouts). Follows [Google Cloud best practices](https://cloud.google.com/storage/docs/retry-strategy).

```typescript
// Default: 3 retries, exponential backoff (1s → 2s → 4s), jitter enabled
const result = await service.generate({
  prompt: 'A sunset over mountains',
  model: 'imagen-3',
  // retry: true (default)
});

// Custom retry configuration
const result = await service.generate({
  prompt: 'A sunset over mountains',
  model: 'imagen-3',
  retry: {
    maxRetries: 5,
    delayMs: 1000,
    backoffMultiplier: 2.0,  // 1s, 2s, 4s, 8s, 16s
    maxDelayMs: 30000,       // Cap at 30s
    jitter: true,            // Randomize to prevent thundering herd
  },
});

// Disable retry
const result = await service.generate({
  prompt: 'A sunset over mountains',
  model: 'imagen-3',
  retry: false,
});
```

**Retryable errors:** 429, 408, 500, 502, 503, 504, timeouts, ECONNRESET, ECONNREFUSED, socket hang up
**Not retried:** 400, 401, 403, and other client errors

| Option | Default | Description |
|--------|---------|-------------|
| `maxRetries` | 3 | Maximum retry attempts |
| `delayMs` | 1000 | Base delay between retries (ms) |
| `backoffMultiplier` | 2.0 | Exponential multiplier per attempt |
| `maxDelayMs` | 30000 | Maximum delay cap (ms) |
| `jitter` | true | Randomize delay to prevent thundering herd |

</details>

<details>
<summary><strong>Logging Configuration</strong></summary>

Control logging via environment variable or API:

```typescript
import { setLogLevel } from '@loonylabs/tti-middleware';

// Set log level programmatically
setLogLevel('warn');  // Only show warnings and errors

// Or via environment variable
// TTI_LOG_LEVEL=error
```

Available levels: `debug`, `info`, `warn`, `error`, `silent`

</details>

<details>
<summary><strong>Debug Logging (Markdown Files)</strong></summary>

Log all TTI requests and responses to markdown files for debugging:

```typescript
import { TTIDebugger } from '@loonylabs/tti-middleware';

// Enable via environment variable
// DEBUG_TTI_REQUESTS=true

// Or programmatically
TTIDebugger.setEnabled(true);
TTIDebugger.setLogsDir('./logs/tti/requests');

// Configure all options at once
TTIDebugger.configure({
  enabled: true,
  logsDir: './logs/tti/requests',
  consoleLog: true,      // Also log to console
  includeBase64: false,  // Exclude base64 data (default)
});
```

**Log file contents:**
- Provider, model, and region
- Full prompt text
- Subject description (for character consistency)
- Reference image metadata
- Response data (duration, image count)
- Errors with full details

**Use case:** Debug why character consistency isn't working by inspecting exactly what prompt and `subjectDescription` are being sent to the API.

</details>

<details>
<summary><strong>Error Handling</strong></summary>

Typed error classes for precise error handling:

```typescript
import {
  TTIError,
  InvalidConfigError,
  QuotaExceededError,
  ProviderUnavailableError,
  GenerationFailedError,
  NetworkError,
  CapabilityNotSupportedError,
} from '@loonylabs/tti-middleware';

try {
  const result = await service.generate({ prompt: 'test' });
} catch (error) {
  if (error instanceof QuotaExceededError) {
    console.log('Rate limit hit, try again later');
  } else if (error instanceof CapabilityNotSupportedError) {
    console.log('Model does not support this feature');
  } else if (error instanceof TTIError) {
    console.log(`TTI Error [${error.code}]: ${error.message}`);
  }
}
```

</details>

## Testing

```bash
# Run all tests
npm test

# Unit tests only (222 tests, >95% coverage)
npm run test:unit

# Unit tests with watch mode
npm run test:unit:watch

# Unit tests with coverage report
npm run test:unit:coverage

# Integration tests (requires TTI_INTEGRATION_TESTS=true)
npm run test:integration

# CI/CD mode (unit tests only, in band)
npm run test:ci

# Manual test scripts
npm run test:manual:google-cloud

# BFL / FLUX live test (real API, spends credits) — run selected steps
npx ts-node tests/manual/bfl-live-test.ts t2i-flux11      # single step
npx ts-node tests/manual/bfl-live-test.ts all             # full coverage
```

### Integration Tests

Integration tests make real API calls. They are **skipped by default**.

```bash
# Enable and run integration tests
TTI_INTEGRATION_TESTS=true npm run test:integration
```

**Prerequisites:**
- `GOOGLE_CLOUD_PROJECT` environment variable
- `GOOGLE_APPLICATION_CREDENTIALS` pointing to service account JSON

## Documentation

- [Getting Started](docs/getting-started.md) - Detailed setup guide
- [Google Cloud Provider](docs/providers/google-cloud.md) - Imagen 3 & Gemini Flash Image
- [GDPR/Compliance](docs/compliance.md) - Data processing agreements
- [Testing Guide](docs/testing.md) - Unit & integration tests
- [CHANGELOG](CHANGELOG.md) - Release notes

## Contributing

We welcome contributions! Please ensure:

1. **Tests:** Add tests for new features
2. **Linting:** Run `npm run lint` before committing
3. **Conventions:** Follow the existing project structure

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- [Documentation](https://github.com/loonylabs-dev/tti-middleware/docs)
- [Issues](https://github.com/loonylabs-dev/tti-middleware/issues)
- [NPM Package](https://www.npmjs.com/package/@loonylabs/tti-middleware)

---

<div align="center">

**Made with care by the LoonyLabs Team**

[![GitHub stars](https://img.shields.io/github/stars/loonylabs-dev/tti-middleware?style=social)](https://github.com/loonylabs-dev/tti-middleware/stargazers)
[![Follow on GitHub](https://img.shields.io/github/followers/loonylabs-dev?style=social&label=Follow)](https://github.com/loonylabs-dev)

</div>
