# Getting Started

This guide walks you through setting up @loonylabs/tti-middleware for text-to-image generation with GDPR compliance.

## Prerequisites

- Node.js 18+
- npm or yarn
- A Google Cloud account (for the recommended Google Cloud provider)

## Installation

```bash
npm install @loonylabs/tti-middleware
```

### Google Cloud SDKs (optional)

Install the SDKs for the models you want to use:

```bash
# For Imagen 3
npm install @google-cloud/aiplatform

# For Gemini Flash Image (with character consistency)
npm install @google/genai

# Install both
npm install @google-cloud/aiplatform @google/genai
```

## Google Cloud Setup

### 1. Create a Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Navigate to **IAM & Admin > Service Accounts**
4. Click **Create Service Account**
5. Grant the following roles:
   - `Vertex AI User` (for API access)
   - `Vertex AI Service Agent` (for model access)
6. Create a JSON key and download it

### 2. Enable APIs

Enable these APIs in your project:

- [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)
- [Cloud AI Platform API](https://console.cloud.google.com/apis/library/ml.googleapis.com)

### 3. Configure Environment

Create a `.env` file:

```bash
# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=./path/to/service-account.json
GOOGLE_CLOUD_REGION=europe-west4  # Recommended for EU + full model support
```

## Quick Start

### Basic Text-to-Image

```typescript
import { TTIService, GoogleCloudTTIProvider } from '@loonylabs/tti-middleware';

// Initialize
const service = new TTIService();
service.registerProvider(new GoogleCloudTTIProvider());

// Generate image
const result = await service.generate({
  prompt: 'A futuristic city skyline at sunset, cyberpunk style',
  model: 'imagen-3',
});

// Access the generated image
const imageBase64 = result.images[0].base64;
const contentType = result.images[0].contentType; // 'image/png'
```

### Character Consistency

Perfect for children's book illustrations:

```typescript
// 1. Create a character
const character = await service.generate({
  prompt: 'A cute cartoon bear with a red hat and blue scarf, watercolor style',
  model: 'gemini-flash-image',
});

// 2. Use the character in a new scene
const scene = await service.generate({
  prompt: 'dancing happily in a forest clearing',
  model: 'gemini-flash-image',
  referenceImages: [{
    base64: character.images[0].base64,
    mimeType: 'image/png',
  }],
  subjectDescription: 'cute cartoon bear with red hat and blue scarf',
});
```

### Check EU Region

```typescript
const provider = new GoogleCloudTTIProvider({ region: 'europe-west4' });

console.log(provider.isEURegion()); // true
console.log(provider.getRegion());     // 'europe-west4'
```

For detailed compliance information (DPA, GDPR), see [docs/compliance.md](compliance.md).

## Choosing a Region

For GDPR compliance, use an EU region:

| Region | Location | Imagen 3 | Gemini Flash |
|--------|----------|----------|--------------|
| `europe-west4` | Netherlands | Yes | Yes |
| `europe-west1` | Belgium | Yes | Yes |
| `europe-north1` | Finland | Yes | Yes |
| `europe-west3` | Frankfurt | Yes | **No** |
| `europe-west9` | Paris | Yes | No |

**Recommendation:** Use `europe-west4` (Netherlands) for full model support.

## Choosing a Model

| Model | Use Case | Character Consistency |
|-------|----------|----------------------|
| `imagen-3` | High-quality images, marketing | No |
| `gemini-flash-image` | Character consistency, illustrations | Yes |

## Next Steps

- [Google Cloud Provider Details](providers/google-cloud.md)
- [GDPR/Compliance Information](compliance.md)
- [Testing Guide](testing.md)
- [API Reference](../README.md#-api-reference)
