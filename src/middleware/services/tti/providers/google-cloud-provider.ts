/**
 * Google Cloud TTI Provider
 *
 * Unified provider for Google Cloud's image generation services:
 * - Imagen 3 (imagegeneration@006) - High quality text-to-image
 * - Gemini 2.5 Flash Image - Text-to-image with character consistency
 *
 * All requests go through Google Cloud (Vertex AI) with proper DPA.
 * EU-compliant when using EU regions.
 *
 * @see https://cloud.google.com/vertex-ai/generative-ai/pricing
 * @see https://cloud.google.com/terms/data-processing-addendum
 */

import {
  TTIProvider,
  TTIRequest,
  TTIResponse,
  TTIImage,
  TTIUsage,
  ModelInfo,
  GoogleCloudRegion,
} from '../../../types';
import {
  BaseTTIProvider,
  InvalidConfigError,
  GenerationFailedError,
  hasReferenceImages,
  isEURegion,
} from './base-tti-provider';
import { TTIDebugger, TTIDebugInfo } from '../utils/debug-tti.utils';

// ============================================================
// CONFIGURATION
// ============================================================

interface GoogleCloudConfig {
  /** Google Cloud Project ID */
  projectId: string;
  /** Default region for requests */
  region: GoogleCloudRegion;
  /** Path to service account JSON file */
  keyFilename?: string;
  /** Service account credentials object (alternative to keyFilename) */
  credentials?: {
    client_email: string;
    private_key: string;
    project_id?: string;
  };
}

// ============================================================
// MODEL DEFINITIONS
// ============================================================

const GOOGLE_CLOUD_MODELS: ModelInfo[] = [
  {
    id: 'imagen-3',
    displayName: 'Imagen 3',
    capabilities: {
      textToImage: true,
      characterConsistency: false, // Requires allowlist for Customization API
      imageEditing: false,
      maxImagesPerRequest: 4,
    },
    availableRegions: [
      'europe-west1',
      'europe-west2',
      'europe-west3',
      'europe-west4',
      'europe-west9',
      'us-central1',
      'us-east4',
    ],
    pricingUrl: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
  },
  {
    id: 'gemini-flash-image',
    displayName: 'Gemini 2.5 Flash Image',
    capabilities: {
      textToImage: true,
      characterConsistency: true, // Built-in support!
      imageEditing: false,
      maxImagesPerRequest: 1,
    },
    // Note: NOT available in europe-west3 (Frankfurt)!
    availableRegions: [
      'europe-west1',
      'europe-west4',
      'europe-north1',
      'us-central1',
      'us-east4',
    ],
    pricingUrl: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
  },
];

// Internal model IDs used in API calls
const MODEL_ID_MAP: Record<string, string> = {
  'imagen-3': 'imagegeneration@006',
  'gemini-flash-image': 'gemini-2.5-flash-image',
};

// ============================================================
// PROVIDER IMPLEMENTATION
// ============================================================

export class GoogleCloudTTIProvider extends BaseTTIProvider {
  private config: GoogleCloudConfig;
  private lastUsedRegion: GoogleCloudRegion | null = null;

  // Lazy-loaded SDK clients
  private aiplatformClient: unknown | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private genaiClient: any | null = null;

  constructor(config?: Partial<GoogleCloudConfig>) {
    super(TTIProvider.GOOGLE_CLOUD);

    const projectId =
      config?.projectId ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      '';

    const region =
      config?.region ||
      (process.env.GOOGLE_CLOUD_REGION as GoogleCloudRegion) ||
      (process.env.VERTEX_AI_REGION as GoogleCloudRegion) ||
      'europe-west4'; // Default to Netherlands (supports all models)

    if (!projectId) {
      throw new InvalidConfigError(
        TTIProvider.GOOGLE_CLOUD,
        'Google Cloud Project ID is required. Set GOOGLE_CLOUD_PROJECT or pass projectId in config.'
      );
    }

    this.config = {
      projectId,
      region,
      keyFilename:
        config?.keyFilename || process.env.GOOGLE_APPLICATION_CREDENTIALS,
      credentials: config?.credentials,
    };

    this.log('info', 'Google Cloud TTI Provider initialized', {
      projectId: this.config.projectId,
      region: this.config.region,
      isEURegion: isEURegion(this.config.region),
      models: this.listModels().map((m) => m.id),
    });
  }

  // ============================================================
  // ITTIProvider IMPLEMENTATION
  // ============================================================

  getDisplayName(): string {
    return 'Google Cloud';
  }

  listModels(): ModelInfo[] {
    return GOOGLE_CLOUD_MODELS;
  }

  getDefaultModel(): string {
    // Default to Gemini Flash Image as it supports character consistency
    return 'gemini-flash-image';
  }

  async generate(request: TTIRequest): Promise<TTIResponse> {
    this.validateRequest(request);

    const modelId = request.model || this.getDefaultModel();
    const modelInfo = this.getModelInfo(modelId);

    if (!modelInfo) {
      throw new InvalidConfigError(
        this.providerName,
        `Unknown model: ${modelId}. Available models: ${this.listModels()
          .map((m) => m.id)
          .join(', ')}`
      );
    }

    // Validate region availability
    const effectiveRegion = this.getEffectiveRegion(modelId);

    // Create debug info for logging
    let debugInfo: TTIDebugInfo | null = null;
    if (TTIDebugger.isEnabled) {
      debugInfo = TTIDebugger.createDebugInfo(
        request,
        this.providerName,
        modelId,
        { region: effectiveRegion }
      );
      await TTIDebugger.logRequest(debugInfo);
    }

    this.log('debug', 'Generating image', {
      model: modelId,
      region: effectiveRegion,
      hasReferenceImages: hasReferenceImages(request),
    });

    try {
      // Route to appropriate implementation with retry support
      let response: TTIResponse;
      switch (modelId) {
        case 'imagen-3':
          response = await this.executeWithRetry(
            request,
            () => this.generateWithImagen(request, effectiveRegion),
            'Imagen API call'
          );
          break;
        case 'gemini-flash-image':
          response = await this.executeWithRetry(
            request,
            () => this.generateWithGemini(request, effectiveRegion),
            'Gemini API call'
          );
          break;
        default:
          throw new InvalidConfigError(this.providerName, `Unknown model: ${modelId}`);
      }

      // Log successful response
      if (debugInfo) {
        debugInfo = TTIDebugger.updateWithResponse(debugInfo, response);
        await TTIDebugger.logResponse(debugInfo);
      }

      return response;
    } catch (error) {
      // Log error
      if (debugInfo) {
        debugInfo = TTIDebugger.updateWithError(debugInfo, error as Error);
        await TTIDebugger.logError(debugInfo);
      }
      throw error;
    }
  }

  // ============================================================
  // PUBLIC HELPER METHODS
  // ============================================================

  /**
   * Get the configured region
   */
  getRegion(): GoogleCloudRegion {
    return this.config.region;
  }

  /**
   * Check if the configured region is hosted in the EU
   */
  isEURegion(): boolean {
    return isEURegion(this.config.region);
  }

  // ============================================================
  // PRIVATE: REGION HANDLING
  // ============================================================

  /**
   * Get the effective region for a model, considering availability
   */
  private getEffectiveRegion(modelId: string): GoogleCloudRegion {
    const modelInfo = this.getModelInfo(modelId);
    if (!modelInfo?.availableRegions) {
      return this.config.region;
    }

    // Check if configured region supports this model
    if (modelInfo.availableRegions.includes(this.config.region)) {
      return this.config.region;
    }

    // Find best alternative (prefer EU regions)
    const euAlternatives = modelInfo.availableRegions.filter(isEURegion);
    if (euAlternatives.length > 0) {
      const fallback = euAlternatives[0] as GoogleCloudRegion;
      this.log(
        'warn',
        `Model ${modelId} not available in ${this.config.region}, using ${fallback}`,
        { configuredRegion: this.config.region, fallbackRegion: fallback }
      );
      return fallback;
    }

    // No EU region available, use first available
    const fallback = modelInfo.availableRegions[0] as GoogleCloudRegion;
    this.log(
      'warn',
      `Model ${modelId} not available in EU regions, using ${fallback}`,
      { configuredRegion: this.config.region, fallbackRegion: fallback }
    );
    return fallback;
  }

  // ============================================================
  // PRIVATE: IMAGEN 3 IMPLEMENTATION
  // ============================================================

  private async generateWithImagen(
    request: TTIRequest,
    region: GoogleCloudRegion
  ): Promise<TTIResponse> {
    const startTime = Date.now();
    const internalModelId = MODEL_ID_MAP['imagen-3'];
    this.lastUsedRegion = region;

    try {
      const { client, helpers } = await this.getAiplatformClient();

      const endpoint = `projects/${this.config.projectId}/locations/${region}/publishers/google/models/${internalModelId}`;

      // Build instance
      const instanceValue = { prompt: request.prompt };
      const instance = helpers.toValue(instanceValue);

      // Build parameters
      const parameterValue: Record<string, unknown> = {
        sampleCount: request.n || 1,
      };

      if (request.aspectRatio) {
        parameterValue.aspectRatio = request.aspectRatio;
      }

      // Pass through provider-specific options
      if (request.providerOptions) {
        if (request.providerOptions.seed !== undefined) {
          parameterValue.seed = request.providerOptions.seed;
        }
        if (request.providerOptions.safetyFilterLevel) {
          parameterValue.safetyFilterLevel = request.providerOptions.safetyFilterLevel;
        }
        if (request.providerOptions.personGeneration) {
          parameterValue.personGeneration = request.providerOptions.personGeneration;
        }
      }

      const parameters = helpers.toValue(parameterValue);

      this.log('debug', 'Sending Imagen request', { endpoint, parameters: parameterValue });

      const [response] = await client.predict({
        endpoint,
        instances: [instance],
        parameters,
      });

      const duration = Date.now() - startTime;

      if (!response.predictions || response.predictions.length === 0) {
        throw new GenerationFailedError(
          this.providerName,
          'No images returned from Imagen API'
        );
      }

      return this.processImagenResponse(response.predictions, helpers, duration);
    } catch (error) {
      if (error instanceof InvalidConfigError || error instanceof GenerationFailedError) {
        throw error;
      }
      throw this.handleError(error as Error, 'during Imagen API call');
    }
  }

  private async getAiplatformClient(): Promise<{
    client: {
      predict: (request: unknown) => Promise<Array<{ predictions?: unknown[] }>>;
    };
    helpers: {
      toValue: (obj: unknown) => unknown;
      fromValue: (val: unknown) => unknown;
    };
  }> {
    if (!this.aiplatformClient) {
      try {
        const { v1, helpers } = await import('@google-cloud/aiplatform');

        const clientOptions: {
          apiEndpoint: string;
          keyFilename?: string;
          credentials?: {
            client_email: string;
            private_key: string;
            project_id?: string;
          };
        } = {
          apiEndpoint: `${this.config.region}-aiplatform.googleapis.com`,
        };

        if (this.config.keyFilename) {
          clientOptions.keyFilename = this.config.keyFilename;
        } else if (this.config.credentials) {
          clientOptions.credentials = this.config.credentials;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.aiplatformClient = new v1.PredictionServiceClient(clientOptions as any);

        return {
          client: this.aiplatformClient as {
            predict: (request: unknown) => Promise<Array<{ predictions?: unknown[] }>>;
          },
          helpers: helpers as {
            toValue: (obj: unknown) => unknown;
            fromValue: (val: unknown) => unknown;
          },
        };
      } catch (error) {
        throw new InvalidConfigError(
          this.providerName,
          `Failed to load @google-cloud/aiplatform. Install it with: npm install @google-cloud/aiplatform`,
          error as Error
        );
      }
    }

    const { helpers } = await import('@google-cloud/aiplatform');
    return {
      client: this.aiplatformClient as {
        predict: (request: unknown) => Promise<Array<{ predictions?: unknown[] }>>;
      },
      helpers: helpers as {
        toValue: (obj: unknown) => unknown;
        fromValue: (val: unknown) => unknown;
      },
    };
  }

  private processImagenResponse(
    predictions: unknown[],
    helpers: { fromValue: (val: unknown) => unknown },
    duration: number
  ): TTIResponse {
    const images: TTIImage[] = [];

    for (const prediction of predictions) {
      const predictionObj = helpers.fromValue(prediction) as {
        bytesBase64Encoded?: string;
        mimeType?: string;
      } | null;

      if (predictionObj?.bytesBase64Encoded) {
        images.push({
          base64: predictionObj.bytesBase64Encoded,
          contentType: predictionObj.mimeType || 'image/png',
        });
      }
    }

    if (images.length === 0) {
      throw new GenerationFailedError(
        this.providerName,
        'No valid images in Imagen response'
      );
    }

    const usage: TTIUsage = {
      imagesGenerated: images.length,
      modelId: 'imagen-3',
    };

    return {
      images,
      metadata: {
        provider: this.providerName,
        model: 'imagen-3',
        region: this.lastUsedRegion || this.config.region,
        duration,
      },
      usage,
    };
  }

  // ============================================================
  // PRIVATE: GEMINI FLASH IMAGE IMPLEMENTATION
  // ============================================================

  private async generateWithGemini(
    request: TTIRequest,
    region: GoogleCloudRegion
  ): Promise<TTIResponse> {
    const startTime = Date.now();
    const internalModelId = MODEL_ID_MAP['gemini-flash-image'];
    this.lastUsedRegion = region;

    try {
      const client = await this.getGenaiClient(region);

      // Build request parts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = [];

      // Add reference images first (for character consistency)
      if (hasReferenceImages(request)) {
        for (const ref of request.referenceImages!) {
          parts.push({
            inlineData: {
              mimeType: ref.mimeType || 'image/png',
              data: ref.base64,
            },
          });
        }

        // Build character consistency prompt if subject description is provided
        if (request.subjectDescription) {
          const fullPrompt = this.buildCharacterConsistencyPrompt(
            request.prompt,
            request.subjectDescription,
            request.referenceImages!.length
          );
          parts.push({ text: fullPrompt });
        } else {
          // No subject description - treat as raw multimodal prompt
          // This allows "image 1", "image 2" style prompting
          parts.push({ text: request.prompt });
        }
      } else {
        parts.push({ text: request.prompt });
      }

      const contents = [{ role: 'user', parts }];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config: any = {
        responseModalities: ['TEXT', 'IMAGE'],
      };

      // Add temperature if provided
      if (request.providerOptions?.temperature !== undefined) {
        config.temperature = request.providerOptions.temperature;
      }

      this.log('debug', 'Sending Gemini request', {
        model: internalModelId,
        region,
        hasReferenceImages: hasReferenceImages(request),
      });

      const response = await client.generateContent({
        model: internalModelId,
        contents,
        config,
      });

      const duration = Date.now() - startTime;

      return this.processGeminiResponse(response, duration);
    } catch (error) {
      if (error instanceof InvalidConfigError || error instanceof GenerationFailedError) {
        throw error;
      }
      throw this.handleError(error as Error, 'during Gemini API call');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getGenaiClient(region: GoogleCloudRegion): Promise<any> {
    // Recreate client if region changed
    if (!this.genaiClient) {
      try {
        const { GoogleGenAI } = await import('@google/genai');

        // Set environment variables for Vertex AI backend
        process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
        process.env.GOOGLE_CLOUD_PROJECT = this.config.projectId;
        process.env.GOOGLE_CLOUD_LOCATION = region;

        this.genaiClient = new GoogleGenAI({
          vertexai: true,
          project: this.config.projectId,
          location: region,
        });

        this.log('debug', 'Initialized @google/genai with Vertex AI backend', {
          project: this.config.projectId,
          location: region,
        });
      } catch (error) {
        throw new InvalidConfigError(
          this.providerName,
          `Failed to load @google/genai. Install it with: npm install @google/genai`,
          error as Error
        );
      }
    }

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generateContent: async (params: any) => {
        return this.genaiClient.models.generateContent(params);
      },
    };
  }

  private buildCharacterConsistencyPrompt(
    userPrompt: string,
    subjectDescription: string,
    referenceCount: number
  ): string {
    const referenceText =
      referenceCount === 1 ? 'the reference image' : `the ${referenceCount} reference images`;

    return `Using ${referenceText} as a reference for the character "${subjectDescription}", generate a new image where: ${userPrompt}

IMPORTANT: Maintain exact visual consistency with the character in the reference - same style, colors, proportions, and distinctive features. The character should be immediately recognizable as the same one from the reference.`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processGeminiResponse(response: any, duration: number): TTIResponse {
    const images: TTIImage[] = [];

    const candidates = response?.candidates || response?.response?.candidates;

    if (!candidates || candidates.length === 0) {
      throw new GenerationFailedError(
        this.providerName,
        'No candidates returned from Gemini API'
      );
    }

    for (const candidate of candidates) {
      const parts = candidate?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          images.push({
            base64: part.inlineData.data,
            contentType: part.inlineData.mimeType || 'image/png',
          });
        }
      }
    }

    if (images.length === 0) {
      const firstParts = candidates[0]?.content?.parts || [];
      const partTypes = firstParts.map(
        (p: { text?: string; inlineData?: { mimeType: string } }) => {
          if (p.text) return `text(${p.text.substring(0, 50)}...)`;
          if (p.inlineData) return `inlineData(${p.inlineData.mimeType})`;
          return 'unknown';
        }
      );

      this.log('error', 'No images in Gemini response', {
        candidateCount: candidates.length,
        partTypes,
      });

      throw new GenerationFailedError(
        this.providerName,
        `No images in response. Model returned: ${partTypes.join(', ')}. ` +
          'Make sure responseModalities includes IMAGE.'
      );
    }

    const usage: TTIUsage = {
      imagesGenerated: images.length,
      modelId: 'gemini-flash-image',
    };

    return {
      images,
      metadata: {
        provider: this.providerName,
        model: 'gemini-flash-image',
        region: this.lastUsedRegion || this.config.region,
        duration,
      },
      usage,
    };
  }
}
