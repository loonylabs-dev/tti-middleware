# Google Cloud Provider

The `GoogleCloudTTIProvider` is the recommended provider for GDPR-compliant image generation. It provides access to Google's Imagen 3 and Gemini 2.5 Flash Image models through Vertex AI.

## Overview

| Feature | Status |
|---------|--------|
| Text-to-Image | Yes |
| Character Consistency | Yes (Gemini Flash only) |
| GDPR Compliant | Yes |
| DPA Available | Yes (CDPA) |
| EU Data Residency | Yes |

## Models

### Imagen 3 (`imagen-3`)

High-quality image generation for marketing, product shots, and general use.

```typescript
const result = await service.generate({
  prompt: 'A professional product photo of a smartwatch',
  model: 'imagen-3',
  aspectRatio: '1:1',
  n: 4, // Up to 4 images
});
```

**Capabilities:**
- Up to 4 images per request
- Multiple aspect ratios (1:1, 16:9, 4:3, 9:16, etc.)
- Seed support for reproducibility
- Safety filter configuration

**SDK:** `@google-cloud/aiplatform`

**Internal Model ID:** `imagegeneration@006`

### Gemini 2.5 Flash Image (`gemini-flash-image`)

Optimized for character consistency in illustrations.

```typescript
const result = await service.generate({
  prompt: 'A cartoon fox wearing a detective hat',
  model: 'gemini-flash-image',
  referenceImages: [{ base64: previousImage, mimeType: 'image/png' }],
  subjectDescription: 'cartoon fox with detective hat',
});
```

**Capabilities:**
- Character consistency via reference images
- 1 image per request
- Multimodal input (text + images)

**SDK:** `@google/genai`

**Internal Model ID:** `gemini-2.5-flash-image`

## Configuration

### Constructor Options

```typescript
const provider = new GoogleCloudTTIProvider({
  projectId: 'my-project',        // Google Cloud Project ID
  region: 'europe-west4',         // Default region
  keyFilename: './sa.json',       // Service account file
  // OR
  credentials: {                  // Direct credentials
    client_email: '...',
    private_key: '...',
  },
});
```

### Environment Variables

```bash
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GOOGLE_CLOUD_REGION=europe-west4
```

## Region Availability

| Region | Location | Imagen 3 | Gemini Flash | Recommended |
|--------|----------|----------|--------------|-------------|
| `europe-west4` | Netherlands | Yes | Yes | **Yes** |
| `europe-west1` | Belgium | Yes | Yes | Yes |
| `europe-north1` | Finland | Yes | Yes | Yes |
| `europe-west3` | Frankfurt | Yes | **No** | No* |
| `europe-west9` | Paris | Yes | No | No* |
| `europe-west2` | London | Yes | No | No* |
| `us-central1` | Iowa | Yes | Yes | No (not EU) |

*These regions only support Imagen 3. For full model support, use `europe-west4`.

### Automatic Region Fallback

If you configure `europe-west3` but request `gemini-flash-image`, the provider automatically falls back to an available EU region:

```typescript
const provider = new GoogleCloudTTIProvider({
  region: 'europe-west3',  // Frankfurt (no Gemini)
});

const result = await service.generate({
  model: 'gemini-flash-image',
  prompt: 'A cat',
});

// Automatically uses europe-west1 or europe-west4
console.log(result.metadata.region); // 'europe-west1'
```

## Character Consistency

### Basic Usage

```typescript
// Step 1: Create a character
const bear = await service.generate({
  prompt: 'A cute cartoon bear with a red hat and blue scarf, children book illustration, watercolor style',
  model: 'gemini-flash-image',
});

// Step 2: Generate new scenes with the same character
const scene1 = await service.generate({
  prompt: 'playing in the snow, building a snowman',
  model: 'gemini-flash-image',
  referenceImages: [{
    base64: bear.images[0].base64,
    mimeType: 'image/png',
  }],
  subjectDescription: 'cute cartoon bear with red hat and blue scarf',
});

const scene2 = await service.generate({
  prompt: 'reading a book by a fireplace',
  model: 'gemini-flash-image',
  referenceImages: [{
    base64: bear.images[0].base64,
    mimeType: 'image/png',
  }],
  subjectDescription: 'cute cartoon bear with red hat and blue scarf',
});
```

### Best Practices

1. **Detailed subject description**: Include distinctive features (colors, accessories, style)
2. **Consistent style**: Keep the art style consistent in your prompts
3. **Clear reference image**: Use a clear, simple pose for the reference
4. **Action in new scenes**: Describe what the character is *doing*, not what it *looks like*

## Provider-Specific Options

### Imagen 3

```typescript
const result = await service.generate({
  prompt: 'A landscape',
  model: 'imagen-3',
  providerOptions: {
    seed: 12345,                    // For reproducibility
    safetyFilterLevel: 'block_medium_and_above',
    personGeneration: 'allow_adult',
  },
});
```

### Gemini Flash

```typescript
const result = await service.generate({
  prompt: 'A character',
  model: 'gemini-flash-image',
  providerOptions: {
    temperature: 0.8,  // Creativity (0.0 - 2.0)
  },
});
```

## Retry Configuration

The provider automatically retries on rate limit errors (429):

```typescript
const result = await service.generate({
  prompt: 'A sunset',
  model: 'imagen-3',
  retry: {
    maxRetries: 3,           // Default: 2
    delayMs: 2000,           // Default: 1000
    incrementalBackoff: true, // Default: false
  },
});
```

## EU Region Check

```typescript
// Check if using EU region
console.log(provider.isEURegion()); // true/false

// Get current region
console.log(provider.getRegion()); // 'europe-west4'
```

For DPA and compliance information, see:
- [Google Cloud CDPA](https://cloud.google.com/terms/data-processing-addendum)
- [Compliance Documentation](../compliance.md)

## Error Handling

```typescript
import { InvalidConfigError, GenerationFailedError, QuotaExceededError } from '@loonylabs/tti-middleware';

try {
  const result = await service.generate({ prompt: 'A cat' });
} catch (error) {
  if (error instanceof InvalidConfigError) {
    // Missing project ID, credentials, etc.
  } else if (error instanceof QuotaExceededError) {
    // Rate limit exceeded (after retries)
  } else if (error instanceof GenerationFailedError) {
    // API returned error
  }
}
```

## Pricing

Pricing is based on the model and number of images:

- **Imagen 3**: [Vertex AI Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- **Gemini Flash**: [Vertex AI Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)

The middleware does not hardcode prices. Usage metrics are returned:

```typescript
console.log(result.usage);
// {
//   imagesGenerated: 1,
//   modelId: 'imagen-3',
// }
```

## See Also

- [Getting Started](../getting-started.md)
- [Compliance Documentation](../compliance.md)
- [Testing Guide](../testing.md)
