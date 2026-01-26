/**
 * Eden AI TTI Provider
 *
 * Aggregator service that provides access to multiple AI providers
 * through a unified API.
 *
 * @see https://www.edenai.co/
 * @see https://docs.edenai.co/docs/pricing
 */

import {
  TTIProvider,
  TTIRequest,
  TTIResponse,
  TTIImage,
  TTIUsage,
  ModelInfo,
} from '../../../types';
import { BaseTTIProvider, InvalidConfigError, GenerationFailedError } from './base-tti-provider';

// ============================================================
// CONFIGURATION
// ============================================================

interface EdenAIConfig {
  apiKey: string;
  apiUrl?: string;
}

interface EdenAIResponse {
  [provider: string]: {
    items?: Array<{
      image?: string; // Base64
      image_resource_url?: string;
      cost?: number;
    }>;
    status?: string;
    error?: string;
    cost?: number;
  };
}

// ============================================================
// MODEL DEFINITIONS
// ============================================================

const EDENAI_MODELS: ModelInfo[] = [
  {
    id: 'openai',
    displayName: 'OpenAI DALL-E',
    capabilities: {
      textToImage: true,
      characterConsistency: false,
      imageEditing: false,
      maxImagesPerRequest: 4,
    },
    pricingUrl: 'https://www.edenai.co/pricing',
  },
  {
    id: 'stabilityai',
    displayName: 'Stability AI',
    capabilities: {
      textToImage: true,
      characterConsistency: false,
      imageEditing: false,
      maxImagesPerRequest: 4,
    },
    pricingUrl: 'https://www.edenai.co/pricing',
  },
  {
    id: 'replicate',
    displayName: 'Replicate',
    capabilities: {
      textToImage: true,
      characterConsistency: false,
      imageEditing: false,
      maxImagesPerRequest: 4,
    },
    pricingUrl: 'https://www.edenai.co/pricing',
  },
];

// ============================================================
// PROVIDER IMPLEMENTATION
// ============================================================

export class EdenAIProvider extends BaseTTIProvider {
  private config: EdenAIConfig;
  private readonly apiUrl: string;

  constructor(config?: Partial<EdenAIConfig>) {
    super(TTIProvider.EDENAI);

    this.config = {
      apiKey: config?.apiKey || process.env.EDENAI_API_KEY || '',
      apiUrl: config?.apiUrl,
    };

    this.apiUrl =
      this.config.apiUrl || 'https://api.edenai.run/v2/image/generation';

    if (!this.config.apiKey) {
      throw new InvalidConfigError(
        this.providerName,
        'EdenAI API key is required (EDENAI_API_KEY)'
      );
    }

    this.log('info', 'Eden AI Provider initialized');
  }

  // ============================================================
  // ITTIProvider IMPLEMENTATION
  // ============================================================

  getDisplayName(): string {
    return 'Eden AI';
  }

  listModels(): ModelInfo[] {
    return EDENAI_MODELS;
  }

  getDefaultModel(): string {
    return 'openai';
  }

  protected async doGenerate(request: TTIRequest): Promise<TTIResponse> {
    // Note: validateRequest() is called by BaseTTIProvider.generate()

    return this.executeWithRetry(
      request,
      () => this.executeGeneration(request),
      'EdenAI API call'
    );
  }

  private async executeGeneration(request: TTIRequest): Promise<TTIResponse> {
    const startTime = Date.now();

    const modelId = request.model || this.getDefaultModel();

    const body = {
      providers: modelId,
      text: request.prompt,
      resolution: request.aspectRatio ? this.aspectRatioToSize(request.aspectRatio) : '1024x1024',
      num_images: request.n || 1,
    };

    this.log('debug', 'Generating image with EdenAI', {
      provider: modelId,
      size: body.resolution,
    });

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`EdenAI API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as EdenAIResponse;

      this.log('debug', 'Raw EdenAI response', { data: JSON.stringify(data) });

      const duration = Date.now() - startTime;

      return this.processResponse(data, modelId, duration);
    } catch (error) {
      throw this.handleError(error as Error, 'during EdenAI API call');
    }
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  private aspectRatioToSize(aspectRatio: string): string {
    const mapping: Record<string, string> = {
      '1:1': '1024x1024',
      '16:9': '1792x1024',
      '9:16': '1024x1792',
      '4:3': '1024x768',
      '3:4': '768x1024',
    };
    return mapping[aspectRatio] || '1024x1024';
  }

  private processResponse(
    data: EdenAIResponse,
    provider: string,
    duration: number
  ): TTIResponse {
    const responseKeys = Object.keys(data);
    const matchedKey = responseKeys.find((key) => key.startsWith(provider));
    const providerData = matchedKey ? data[matchedKey] : undefined;

    if (!providerData) {
      this.log(
        'error',
        `Provider data not found for ${provider}. Available keys: ${responseKeys.join(', ')}`
      );
      throw new GenerationFailedError(
        this.providerName,
        `No data returned for provider: ${provider}`
      );
    }

    if (providerData.status === 'fail' || providerData.error) {
      throw new GenerationFailedError(
        this.providerName,
        providerData.error || 'Unknown error from provider'
      );
    }

    const items = providerData.items || [];
    const images: TTIImage[] = [];

    for (const item of items) {
      if (item.image) {
        images.push({ base64: item.image, contentType: 'image/png' });
      } else if (item.image_resource_url) {
        images.push({ url: item.image_resource_url });
      }
    }

    if (images.length === 0) {
      throw new GenerationFailedError(
        this.providerName,
        'No images returned in response'
      );
    }

    const usage: TTIUsage = {
      imagesGenerated: images.length,
      modelId: provider,
    };

    return {
      images,
      metadata: {
        provider: this.providerName,
        model: provider,
        duration,
      },
      usage,
      // Eden AI returns actual cost from provider!
      billing: providerData.cost
        ? {
            cost: providerData.cost,
            currency: 'USD',
            source: 'provider',
          }
        : undefined,
    };
  }
}
