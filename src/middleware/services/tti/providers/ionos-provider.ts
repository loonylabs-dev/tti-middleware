/**
 * IONOS TTI Provider
 *
 * IONOS Cloud AI service with OpenAI-compatible API.
 *
 * @see https://cloud.ionos.de/
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

interface IonosConfig {
  apiKey: string;
  apiUrl?: string;
}

interface OpenAIImageGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

// ============================================================
// MODEL DEFINITIONS
// ============================================================

const IONOS_MODELS: ModelInfo[] = [
  {
    id: 'default',
    displayName: 'IONOS Image Generation',
    capabilities: {
      textToImage: true,
      characterConsistency: false,
      imageEditing: false,
      maxImagesPerRequest: 4,
    },
    pricingUrl: 'https://cloud.ionos.de/preise',
  },
];

// ============================================================
// PROVIDER IMPLEMENTATION
// ============================================================

export class IonosProvider extends BaseTTIProvider {
  private config: IonosConfig;
  private readonly apiUrl: string;

  constructor(config?: Partial<IonosConfig>) {
    super(TTIProvider.IONOS);

    this.config = {
      apiKey: config?.apiKey || process.env.IONOS_API_KEY || '',
      apiUrl: config?.apiUrl || process.env.IONOS_API_URL,
    };

    const baseUrl = this.config.apiUrl || 'https://api.ionos.cloud/ai/v1';
    this.apiUrl = `${baseUrl.replace(/\/+$/, '')}/images/generations`;

    if (!this.config.apiKey) {
      throw new InvalidConfigError(
        this.providerName,
        'IONOS API key is required (IONOS_API_KEY)'
      );
    }

    this.log('info', 'IONOS Provider initialized');
  }

  // ============================================================
  // ITTIProvider IMPLEMENTATION
  // ============================================================

  getDisplayName(): string {
    return 'IONOS Cloud';
  }

  listModels(): ModelInfo[] {
    return IONOS_MODELS;
  }

  getDefaultModel(): string {
    return 'default';
  }

  async generate(request: TTIRequest): Promise<TTIResponse> {
    this.validateRequest(request);

    return this.executeWithRetry(
      request,
      () => this.executeGeneration(request),
      'IONOS API call'
    );
  }

  private async executeGeneration(request: TTIRequest): Promise<TTIResponse> {
    const startTime = Date.now();

    const body = {
      prompt: request.prompt,
      n: request.n || 1,
      size: request.aspectRatio ? this.aspectRatioToSize(request.aspectRatio) : '1024x1024',
      response_format: 'url',
      model: request.model !== 'default' ? request.model : undefined,
    };

    this.log('debug', 'Generating image with IONOS', {
      size: body.size,
      model: body.model,
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
        throw new Error(`IONOS API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as OpenAIImageGenerationResponse;
      const duration = Date.now() - startTime;

      return this.processResponse(data, duration);
    } catch (error) {
      throw this.handleError(error as Error, 'during IONOS API call');
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
    data: OpenAIImageGenerationResponse,
    duration: number
  ): TTIResponse {
    if (!data.data || data.data.length === 0) {
      throw new GenerationFailedError(
        this.providerName,
        'No images returned in response'
      );
    }

    const images: TTIImage[] = data.data.map((item) => {
      if (item.b64_json) {
        return { base64: item.b64_json, contentType: 'image/png' };
      }
      return { url: item.url };
    });

    const usage: TTIUsage = {
      imagesGenerated: images.length,
      modelId: 'default',
    };

    return {
      images,
      metadata: {
        provider: this.providerName,
        model: 'default',
        duration,
      },
      usage,
    };
  }
}
