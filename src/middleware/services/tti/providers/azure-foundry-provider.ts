/**
 * Microsoft Foundry (Azure) TTI Provider — FLUX models served by Azure.
 *
 * Uses the BFL provider-specific API exposed by Microsoft Foundry:
 *
 *   POST {endpoint}/providers/blackforestlabs/v1/{model-path}?api-version=preview
 *
 * Unlike the direct Black Forest Labs API (async submit + poll, see
 * BflProvider), the Foundry route is SYNCHRONOUS: a single POST returns the
 * image inline in an OpenAI-images-style envelope:
 *
 *   { "created": <unix>, "data": [{ "b64_json": "<base64>" }], "request_meta": {…} }
 *
 * (Verified 2026-05-30 against a live FLUX.2-pro DataZoneStandard deployment in
 * germanywestcentral — HTTP 200, ~6 s, b64_json, no polling, no expiring URL.)
 *
 * Data protection: when the model is deployed as `DataZoneStandard` in an EU
 * region, processing stays within the EU Data Boundary and is covered by the
 * Microsoft Products and Services DPA (Art. 28). Inputs/outputs are not shared
 * with BFL and not used for training. Residency is a DEPLOYMENT property (the
 * SKU + resource region) and cannot be enforced from this client — pick a
 * DataZoneStandard EU deployment.
 *
 * @see https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-flux
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

interface AzureFoundryConfig {
  /** Azure resource key (sent as `Authorization: Bearer <key>`). */
  apiKey: string;
  /** Resource endpoint, e.g. https://<resource>.services.ai.azure.com */
  endpoint: string;
  /** API version query param. Default: 'preview'. */
  apiVersion?: string;
}

/** Synchronous BFL-on-Foundry response (OpenAI-images-style envelope). */
interface AzureFoundryResponse {
  created?: number;
  data?: Array<{
    b64_json?: string;
    url?: string;
    [key: string]: unknown;
  }>;
  request_meta?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================================
// MODEL DEFINITIONS
// ============================================================

/**
 * Model definition including the Foundry endpoint path segment and the public
 * `model` field value the body expects. The middleware model id, the endpoint
 * `<model-path>`, and the body `model` name are all DIFFERENT on Foundry, so
 * all three are carried explicitly (single source of truth).
 *
 * Model ids are suffixed `-azure` so they never collide with the BflProvider
 * ids (`flux-2-pro`, …) when a consumer builds a flat model→provider routing
 * map across both providers.
 */
interface AzureFoundryModelDef extends ModelInfo {
  /** Endpoint path segment used in `/providers/blackforestlabs/v1/{apiPath}`. */
  apiPath: string;
  /** Value for the request body `model` field. */
  modelName: string;
  /** true → Foundry requires a separate registration/approval before deploy. */
  requiresRegistration?: boolean;
}

const AZURE_FOUNDRY_MODELS: AzureFoundryModelDef[] = [
  {
    // LIVE-VERIFIED 2026-05-30 against a DataZoneStandard germanywestcentral deployment.
    id: 'flux-2-pro-azure',
    apiPath: 'flux-2-pro',
    modelName: 'FLUX.2-pro',
    displayName: 'FLUX.2 [pro] (Azure Foundry)',
    capabilities: {
      textToImage: true,
      // Multi-reference editing via input_image / input_image_2 … (up to 8).
      characterConsistency: true,
      imageEditing: false, // no mask-based inpainting
      maxImagesPerRequest: 1,
    },
    pricingUrl: 'https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/black-forest-labs/',
  },
  {
    id: 'flux-1.1-pro-azure',
    apiPath: 'flux-pro-1.1',
    modelName: 'FLUX-1.1-pro',
    displayName: 'FLUX1.1 [pro] (Azure Foundry)',
    capabilities: {
      textToImage: true,
      characterConsistency: false,
      imageEditing: false,
      maxImagesPerRequest: 1,
    },
    pricingUrl: 'https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/black-forest-labs/',
  },
  {
    id: 'flux-kontext-pro-azure',
    apiPath: 'flux-kontext-pro',
    modelName: 'FLUX.1-Kontext-pro',
    displayName: 'FLUX.1 Kontext [pro] (Azure Foundry)',
    capabilities: {
      textToImage: true,
      // In-context editing / character consistency via input_image (single ref).
      characterConsistency: true,
      imageEditing: false,
      maxImagesPerRequest: 1,
    },
    pricingUrl: 'https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/black-forest-labs/',
  },
  {
    id: 'flux-2-flex-azure',
    apiPath: 'flux-2-flex',
    modelName: 'FLUX.2-flex',
    displayName: 'FLUX.2 [flex] (Azure Foundry)',
    capabilities: {
      textToImage: true,
      characterConsistency: true, // up to 10 reference images
      imageEditing: false,
      maxImagesPerRequest: 1,
    },
    requiresRegistration: true,
    pricingUrl: 'https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/black-forest-labs/',
  },
];

// ============================================================
// PROVIDER IMPLEMENTATION
// ============================================================

export class AzureFoundryProvider extends BaseTTIProvider {
  private config: AzureFoundryConfig;
  private readonly baseUrl: string;
  private readonly apiVersion: string;

  /** Body fields that are middleware-only control keys, not Foundry params. */
  private static readonly RESERVED_OPTION_KEYS = new Set([
    'outputFormat',
    'returnUrls',
  ]);

  constructor(config?: Partial<AzureFoundryConfig>) {
    super(TTIProvider.AZURE_FOUNDRY);

    this.config = {
      apiKey: config?.apiKey || process.env.AZURE_FOUNDRY_API_KEY || '',
      endpoint: config?.endpoint || process.env.AZURE_FOUNDRY_ENDPOINT || '',
      apiVersion: config?.apiVersion || process.env.AZURE_FOUNDRY_API_VERSION || 'preview',
    };

    this.baseUrl = (this.config.endpoint || '').replace(/\/+$/, '');
    this.apiVersion = this.config.apiVersion || 'preview';

    if (!this.config.apiKey) {
      throw new InvalidConfigError(
        this.providerName,
        'Azure Foundry API key is required (AZURE_FOUNDRY_API_KEY)'
      );
    }
    if (!this.baseUrl) {
      throw new InvalidConfigError(
        this.providerName,
        'Azure Foundry endpoint is required (AZURE_FOUNDRY_ENDPOINT, ' +
          'e.g. https://<resource>.services.ai.azure.com)'
      );
    }

    this.log('info', 'Azure Foundry Provider initialized', {
      endpoint: this.baseUrl,
      apiVersion: this.apiVersion,
    });
  }

  // ============================================================
  // ITTIProvider IMPLEMENTATION
  // ============================================================

  getDisplayName(): string {
    return 'Microsoft Foundry (FLUX)';
  }

  listModels(): ModelInfo[] {
    return AZURE_FOUNDRY_MODELS;
  }

  getDefaultModel(): string {
    return 'flux-2-pro-azure';
  }

  protected async doGenerate(request: TTIRequest): Promise<TTIResponse> {
    const modelId = request.model || this.getDefaultModel();
    const modelDef = AZURE_FOUNDRY_MODELS.find((m) => m.id === modelId);

    if (!modelDef) {
      throw new InvalidConfigError(
        this.providerName,
        `Unknown Azure Foundry model '${modelId}'. Available: ${AZURE_FOUNDRY_MODELS.map((m) => m.id).join(', ')}`
      );
    }

    if (modelDef.requiresRegistration) {
      this.log(
        'warn',
        `Model '${modelId}' requires a separate Microsoft Foundry registration/approval ` +
          'before it can be deployed — calls will fail until the deployment exists.',
        { model: modelId }
      );
    }

    const startTime = Date.now();
    const n = request.n && request.n > 0 ? request.n : 1;
    const body = this.buildRequestBody(request, modelDef, n);

    this.log('info', 'Generating image(s) with Azure Foundry', { model: modelId, n });

    // Single SYNCHRONOUS POST — the POST *is* the (billed) generation, so it is
    // NOT idempotent. The base retry wrapper still retries transient pre-generation
    // failures (429/5xx/network — no image produced, safe), but timeout-retries are
    // forced to 0 via withSafeRetry(): re-POSTing after a timeout could create a
    // SECOND billed image if the first generation actually succeeded server-side.
    // (The BflProvider solves the same hazard by keeping its poll outside retry.)
    let data: AzureFoundryResponse;
    try {
      data = await this.executeWithRetry(
        this.withSafeRetry(request),
        () => this.submitRequest(modelDef.apiPath, body),
        `Azure Foundry generate (${modelDef.apiPath})`
      );
    } catch (error) {
      throw this.handleError(error as Error, 'during Azure Foundry generation');
    }

    const images = this.extractImages(data, request);
    const duration = Date.now() - startTime;

    if (images.length === 0) {
      throw new GenerationFailedError(
        this.providerName,
        'Azure Foundry returned no image data (no b64_json / url in response.data)'
      );
    }

    const usage: TTIUsage = {
      imagesGenerated: images.length,
      modelId,
    };

    return {
      images,
      metadata: {
        provider: this.providerName,
        model: modelId,
        duration,
      },
      usage,
    };
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  /**
   * Return a request whose retry config never retries on TIMEOUT.
   *
   * The synchronous generation POST is not idempotent (no idempotency key), so
   * a timeout-retry risks a second billed image if the first generation
   * actually completed server-side. We default `timeoutRetries` to 0 while
   * leaving general retries (429/5xx/network — safe, no image produced)
   * untouched. An explicit caller-provided `timeoutRetries` is respected; an
   * explicit `retry: false` disables retry entirely (returned as-is).
   */
  private withSafeRetry(request: TTIRequest): TTIRequest {
    if (request.retry === false) return request;
    const base = typeof request.retry === 'object' && request.retry ? request.retry : {};
    if (base.timeoutRetries === undefined) {
      return { ...request, retry: { ...base, timeoutRetries: 0 } };
    }
    return request;
  }

  /**
   * POST the generation job and return the parsed (synchronous) response.
   *
   * Throws RAW errors (with the HTTP status in the message) so the base class's
   * executeWithRetry/isRetryableError can classify them (429/5xx → retryable,
   * 401/403/400 → not). Conversion to a typed TTIError happens at the boundary
   * in doGenerate.
   */
  private async submitRequest(
    apiPath: string,
    body: Record<string, unknown>
  ): Promise<AzureFoundryResponse> {
    const url = `${this.baseUrl}/providers/blackforestlabs/v1/${apiPath}?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure Foundry error (${response.status}): ${errorText}`);
    }

    return (await response.json()) as AzureFoundryResponse;
  }

  /**
   * Extract images from the synchronous response envelope
   * `{ data: [{ b64_json | url }] }`. Returns base64 by default; only yields a
   * raw URL when the provider returned one (Foundry returns b64_json inline, so
   * URLs are rare). `providerOptions.returnUrls` is honoured when a URL exists.
   */
  private extractImages(data: AzureFoundryResponse, request: TTIRequest): TTIImage[] {
    const items = Array.isArray(data.data) ? data.data : [];
    const returnUrls = request.providerOptions?.returnUrls === true;
    const contentType = this.outputContentType(request);

    const images: TTIImage[] = [];
    for (const item of items) {
      if (returnUrls && item.url) {
        images.push({ url: item.url });
      } else if (item.b64_json) {
        images.push({ base64: item.b64_json, contentType });
      } else if (item.url) {
        images.push({ url: item.url });
      }
    }
    return images;
  }

  /** Map the requested output_format to a MIME type for base64 images. */
  private outputContentType(request: TTIRequest): string {
    const fmt = String(request.providerOptions?.outputFormat || 'jpeg').toLowerCase();
    return fmt === 'png' ? 'image/png' : 'image/jpeg';
  }

  /**
   * Build the Foundry request body from the unified request.
   * - flux-kontext-pro: aspect_ratio passed through as a string
   * - other models: width/height derived from aspectRatio
   * - reference images map to input_image, input_image_2, …
   * - subjectDescription (structured mode) wraps the prompt with the shared
   *   character-consistency template — identical to the BFL / Google providers
   * - providerOptions act as an escape hatch and override derived fields
   *   (guidance, steps, seed, safety_tolerance, …)
   */
  private buildRequestBody(
    request: TTIRequest,
    modelDef: AzureFoundryModelDef,
    n: number
  ): Record<string, unknown> {
    const opts = request.providerOptions || {};
    const outputFormat = (opts.outputFormat as string) || 'jpeg';
    const refs = request.referenceImages || [];

    // Clamp num_images to the model's per-request maximum. All current
    // FLUX-on-Foundry models return exactly one image per request
    // (maxImagesPerRequest=1); n>1 per request is unverified, so we never send
    // an unsupported value — we send at most `max` and warn on truncation.
    const max = modelDef.capabilities.maxImagesPerRequest;
    const numImages = Math.min(n, max);
    if (n > max) {
      this.log(
        'warn',
        `Requested n=${n} exceeds ${modelDef.id} maxImagesPerRequest=${max}; clamping num_images to ${max}`,
        { model: modelDef.id, requested: n, sent: numImages, max }
      );
    }

    // Structured mode: enrich the prompt with the shared consistency template
    // when a subjectDescription accompanies reference images (same behaviour as
    // BflProvider / GoogleCloudTTIProvider). Otherwise pass the prompt verbatim.
    const prompt =
      request.subjectDescription && refs.length > 0
        ? this.buildCharacterConsistencyPrompt(
            request.prompt,
            request.subjectDescription,
            refs.length
          )
        : request.prompt;

    const body: Record<string, unknown> = {
      model: modelDef.modelName,
      prompt,
      output_format: outputFormat,
      num_images: numImages,
    };

    if (modelDef.apiPath === 'flux-kontext-pro') {
      if (request.aspectRatio) {
        body.aspect_ratio = request.aspectRatio;
      }
    } else {
      const { width, height } = this.aspectRatioToDimensions(request.aspectRatio);
      body.width = width;
      body.height = height;
    }

    // Reference images (character consistency / prompt-based editing).
    refs.forEach((ref, index) => {
      const key = index === 0 ? 'input_image' : `input_image_${index + 1}`;
      body[key] = ref.base64;
    });

    // Pass-through escape hatch — explicit provider options win.
    for (const [key, value] of Object.entries(opts)) {
      if (!AzureFoundryProvider.RESERVED_OPTION_KEYS.has(key)) {
        body[key] = value;
      }
    }

    return body;
  }
}
