# @loonylabs/tti-middleware

[![npm version](https://img.shields.io/npm/v/@loonylabs/tti-middleware.svg)](https://www.npmjs.com/package/@loonylabs/tti-middleware)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Provider-agnostic Text-to-Image middleware with **GDPR/DSGVO compliance** and **character consistency** support.

---

## ✨ Key Features

- 🎨 **Multiple Providers**: Google Cloud, Eden AI, IONOS
- 🖼️ **Character Consistency**: Generate consistent characters across multiple images (perfect for children's book illustrations)
- 🇪🇺 **GDPR Compliant**: Built-in compliance information with DPA links
- 📋 **Compliance First**: Check DPA status, data residency, and GDPR compliance per provider
- 🔄 **Provider-Agnostic**: Unified interface with provider-specific model selection
- 📦 **TypeScript-First**: Full TypeScript support with comprehensive types

## 📦 Installation

```bash
npm install @loonylabs/tti-middleware

# For Google Cloud provider (recommended):
npm install @google-cloud/aiplatform @google/genai
```

## 🚀 Quick Start

### Basic Text-to-Image

```typescript
import { TTIService, GoogleCloudTTIProvider, TTIProvider } from '@loonylabs/tti-middleware';

const service = new TTIService();
service.registerProvider(new GoogleCloudTTIProvider({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  region: 'europe-west4', // EU region for GDPR
}));

const result = await service.generate({
  prompt: 'A futuristic city with flying cars, cyberpunk style',
  model: 'gemini-flash-image',
});

console.log('Image:', result.images[0].base64);
```

### Character Consistency (Children's Book Illustrations)

```typescript
// 1. Create the character
const character = await service.generate({
  prompt: 'A cute cartoon bear with a red hat and blue scarf, watercolor style',
  model: 'gemini-flash-image',
});

// 2. Generate new scenes with the same character
const scene = await service.generate({
  prompt: 'dancing happily in the rain, jumping in puddles',
  model: 'gemini-flash-image',
  referenceImages: [{
    base64: character.images[0].base64,
    mimeType: 'image/png',
  }],
  subjectDescription: 'cute cartoon bear with red hat and blue scarf',
});
```

## 🔒 GDPR / DPA Compliance

**Note:** Compliance information is provided in documentation only. Please verify with the respective provider before making compliance decisions.

### Provider Compliance Overview

| Provider | DPA | GDPR | EU Data Residency | DPA Document |
|----------|-----|------|-------------------|--------------|
| **Google Cloud** | ✅ | ✅ | ✅ | [CDPA](https://cloud.google.com/terms/data-processing-addendum) |
| **Eden AI** | ✅ | ⚠️* | ⚠️* | [Privacy Policy](https://www.edenai.co/privacy-policy) |
| **IONOS** | ✅ | ✅ | ✅ | [AGB](https://cloud.ionos.de/agb) |

*Eden AI is an aggregator - compliance depends on the underlying provider you select.

### Google Cloud Data Usage

- ✅ Customer data is **NOT used for training** AI models
- ✅ Data stays in configured region (e.g., `europe-west4`)
- ✅ Zero data retention option available
- 📖 [Vertex AI Privacy Whitepaper](https://services.google.com/fh/files/misc/genai_privacy_google_cloud_202308.pdf)

## 🧩 Supported Providers & Models

### Google Cloud

| Model | Character Consistency | EU Regions |
|-------|----------------------|------------|
| `imagen-3` (Imagen 3) | ❌ | All EU regions |
| `gemini-flash-image` (Gemini 2.5 Flash) | ✅ | europe-west1, europe-west4, europe-north1 |

⚠️ **Important:** `gemini-flash-image` is **NOT available** in `europe-west3` (Frankfurt)!

### Eden AI

| Model | Character Consistency |
|-------|----------------------|
| `openai` (DALL-E) | ❌ |
| `stabilityai` (Stable Diffusion) | ❌ |
| `replicate` | ❌ |

### IONOS

| Model | Character Consistency |
|-------|----------------------|
| `default` | ❌ |

## 🔧 Configuration

### Environment Variables

```bash
# Default provider
TTI_DEFAULT_PROVIDER=google-cloud

# Google Cloud (recommended for EU)
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GOOGLE_CLOUD_REGION=europe-west4  # Recommended for Gemini

# Eden AI
EDENAI_API_KEY=your-api-key

# IONOS
IONOS_API_KEY=your-api-key
IONOS_API_URL=https://api.ionos.cloud/ai/v1
```

### Google Cloud Regions

| Region | Location | Imagen 3 | Gemini Flash Image |
|--------|----------|----------|-------------------|
| `europe-west1` | Belgium | ✅ | ✅ |
| `europe-west3` | Frankfurt | ✅ | ❌ |
| `europe-west4` | Netherlands | ✅ | ✅ **Recommended** |
| `europe-north1` | Finland | ✅ | ✅ |
| `europe-west9` | Paris | ✅ | ❌ |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        TTIService                           │
│  ┌─────────────────────────────────────────────────────────┤
│  │  generate()           getProviderCompliance()           │
│  │  listAllModels()      findProvidersWithCapability()     │
│  └─────────────────────────────────────────────────────────┤
└─────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
           ▼                  ▼                  ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │ GoogleCloud │    │   EdenAI    │    │    IONOS    │
    │  Provider   │    │  Provider   │    │  Provider   │
    ├─────────────┤    ├─────────────┤    ├─────────────┤
    │ Models:     │    │ Models:     │    │ Models:     │
    │ - imagen-3  │    │ - openai    │    │ - default   │
    │ - gemini-   │    │ - stability │    │             │
    │   flash     │    │ - replicate │    │             │
    └─────────────┘    └─────────────┘    └─────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │ Vertex AI   │    │ Eden AI API │    │  IONOS API  │
    │ (Google     │    │ (Aggregator)│    │ (OpenAI-    │
    │  Cloud)     │    │             │    │  compatible)│
    └─────────────┘    └─────────────┘    └─────────────┘
```

## 📖 API Reference

### TTIService

```typescript
class TTIService {
  registerProvider(provider: BaseTTIProvider): void;
  generate(request: TTIRequest, provider?: TTIProvider): Promise<TTIResponse>;
  getProvider(name: TTIProvider): BaseTTIProvider | undefined;
  listAllModels(): Array<{ provider: TTIProvider; models: ModelInfo[] }>;
  findProvidersWithCapability(capability: string): Array<...>;
}
```

### TTIRequest

```typescript
interface TTIRequest {
  prompt: string;
  model?: string;           // 'imagen-3', 'gemini-flash-image', etc.
  n?: number;               // Number of images (default: 1)
  aspectRatio?: string;     // '1:1', '16:9', '4:3', etc.

  // Character consistency
  referenceImages?: TTIReferenceImage[];
  subjectDescription?: string;

  // Retry configuration
  retry?: boolean | RetryOptions;  // true (default), false, or custom config

  providerOptions?: Record<string, unknown>;
}
```

### RetryOptions

```typescript
interface RetryOptions {
  maxRetries?: number;        // Default: 2
  delayMs?: number;           // Default: 1000
  incrementalBackoff?: boolean;  // Default: false
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
  billing?: {          // Only if provider returns costs (e.g., Eden AI)
    cost: number;
    currency: string;
    source: 'provider' | 'estimated';
  };
}
```

## 💰 Pricing

This middleware does **not hardcode prices**. Instead:

1. **Usage metrics** are always returned (`imagesGenerated`, `modelId`)
2. **Actual costs** are passed through when the provider returns them (Eden AI)

For pricing information, see:
- [Google Cloud Vertex AI Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [Eden AI Pricing](https://www.edenai.co/pricing)
- [IONOS Pricing](https://cloud.ionos.de/preise)

## 🔄 Retry Logic

Automatic retry for rate limit errors (429):

```typescript
// Default: 2 retries, 1s delay, no backoff
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
    maxRetries: 3,
    delayMs: 2000,
    incrementalBackoff: true,  // 2s, 4s, 6s...
  },
});

// Disable retry
const result = await service.generate({
  prompt: 'A sunset over mountains',
  model: 'imagen-3',
  retry: false,
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `maxRetries` | 2 | Maximum retry attempts |
| `delayMs` | 1000 | Base delay between retries (ms) |
| `incrementalBackoff` | false | If true: delay × attempt number |

## 🧪 Testing

```bash
# Run all tests
npm test

# Unit tests only (123 tests, >95% coverage)
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

## 📖 Documentation

- [Getting Started](docs/getting-started.md) - Detailed setup guide
- [Google Cloud Provider](docs/providers/google-cloud.md) - Imagen 3 & Gemini Flash Image
- [GDPR/Compliance](docs/compliance.md) - Data processing agreements
- [Testing Guide](docs/testing.md) - Unit & integration tests
- [CHANGELOG](CHANGELOG.md) - Release notes

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

Made with ❤️ by the LoonyLabs Team
