# GDPR/DSGVO Compliance

This document provides compliance information for organizations that need to meet GDPR (General Data Protection Regulation) and DSGVO (Datenschutz-Grundverordnung) requirements.

**Important:** This information is provided for reference only. The middleware does NOT programmatically return compliance data to avoid any implied warranties or liability. Always verify compliance information directly with the provider before making business decisions.

## Architecture: Provider = Backend = One DPA

The middleware follows a clear architectural principle:

**One Provider = One Backend = One Data Processing Agreement (DPA)**

This means:
- Each provider represents a single contract partner
- Each provider has its own DPA that covers all models/features
- Compliance should be verified per provider through their official documentation

## Provider Compliance Overview

| Provider | DPA | GDPR | EU Residency | DPA Document |
|----------|-----|------|--------------|--------------|
| **Google Cloud** | Yes | Yes | Yes | [CDPA](https://cloud.google.com/terms/data-processing-addendum) |
| **Eden AI** | Yes | Varies* | Varies* | [Privacy Policy](https://www.edenai.co/privacy-policy) |
| **IONOS** | Yes | Yes | Yes | [AGB](https://cloud.ionos.de/agb) |

*Eden AI is an aggregator - compliance depends on the underlying provider you select.

## Checking EU Region

The middleware provides helper methods to check if you're using an EU region:

```typescript
const googleProvider = new GoogleCloudTTIProvider({
  region: 'europe-west4',
});

// Check if using EU region
console.log(googleProvider.isEURegion()); // true

// Get the configured region
console.log(googleProvider.getRegion()); // 'europe-west4'
```

For DPA and GDPR compliance verification, refer to the official provider documentation linked in the table above.

## Google Cloud (Recommended)

### Data Processing Agreement

Google Cloud offers a **Cloud Data Processing Addendum (CDPA)** that covers:

- Data processing terms under GDPR
- Security measures
- Data deletion procedures
- Subprocessor management

**Document:** https://cloud.google.com/terms/data-processing-addendum

### Data Usage Policy

Google Cloud Vertex AI:
- Customer data is **NOT used for training** AI models
- Data stays in the configured region
- Zero data retention option available

**Reference:** [Vertex AI Privacy Whitepaper](https://services.google.com/fh/files/misc/genai_privacy_google_cloud_202308.pdf)

### EU Regions

| Region | Location | Recommendation |
|--------|----------|----------------|
| `europe-west4` | Netherlands | **Recommended** (full model support) |
| `europe-west1` | Belgium | Good |
| `europe-north1` | Finland | Good |
| `europe-west3` | Frankfurt | Limited (no Gemini) |
| `europe-west9` | Paris | Limited (no Gemini) |

### Configuration for EU Compliance

```typescript
const provider = new GoogleCloudTTIProvider({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  region: 'europe-west4',  // EU region
});

// Verify EU region is configured
console.log(provider.isEURegion()); // true
console.log(provider.getRegion()); // 'europe-west4'
```

## Eden AI

### Important Notice

Eden AI is an **aggregator** that routes requests to underlying providers (OpenAI, Stability AI, etc.). This means:

- Eden AI itself has a privacy policy
- BUT compliance depends on which sub-provider handles your request
- Each sub-provider has different compliance characteristics

### DPA

Eden AI provides DPA on request for enterprise customers.

**Contact:** https://www.edenai.co/contact

### Recommendation

For strict GDPR compliance, consider:
1. Contacting Eden AI for specific provider compliance
2. Using Google Cloud or IONOS directly

## IONOS

### German Cloud Provider

IONOS is a German cloud provider with:
- German headquarters
- EU data centers
- German legal framework

### DPA

IONOS includes data processing terms in their general terms and conditions.

**Document:** https://cloud.ionos.de/agb

## Best Practices

### 1. Document Your Choice

For audits, document:
- Which provider you use
- Which region
- Link to the DPA (see table above)
- Date of DPA acceptance

### 2. Use EU Regions

```typescript
import { GoogleCloudTTIProvider } from '@loonylabs/tti-middleware';

const provider = new GoogleCloudTTIProvider({
  region: 'europe-west4',  // EU region
});

// Verify EU region is configured
if (!provider.isEURegion()) {
  throw new Error('Non-EU region configured');
}
```

### 3. Log Region Info

```typescript
const provider = service.getProvider('google-cloud') as GoogleCloudTTIProvider;

logger.info('TTI Provider Configuration', {
  provider: provider.getName(),
  region: provider.getRegion(),
  isEU: provider.isEURegion(),
  timestamp: new Date().toISOString(),
});
```

### 4. Handle Response Metadata

```typescript
const result = await service.generate({ prompt: 'A sunset' });

// Log where the request was processed
logger.info('Image generated', {
  provider: result.metadata.provider,
  region: result.metadata.region,  // e.g., 'europe-west4'
  model: result.metadata.model,
});
```

## FAQ

### Q: Is Google AI Studio (API Key) GDPR compliant?

**No.** Google AI Studio uses API keys and does NOT have a DPA. Always use Google Cloud Vertex AI (Service Account) for GDPR compliance.

### Q: Can I use US regions?

Technically yes, but it may not meet GDPR requirements. Use EU regions for compliance.

### Q: What if Gemini isn't available in my preferred region?

The provider automatically falls back to another EU region. Check `result.metadata.region` to see where the request was processed.

### Q: How do I get a DPA from Eden AI?

Contact Eden AI directly for enterprise DPA: https://www.edenai.co/contact

## See Also

- [Getting Started](getting-started.md)
- [Google Cloud Provider](providers/google-cloud.md)
- [Testing Guide](testing.md)
