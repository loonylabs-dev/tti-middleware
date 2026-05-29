/**
 * Black Forest Labs (BFL / FLUX) TTI Provider
 *
 * Direct integration with the Black Forest Labs FLUX API via the dedicated
 * EU endpoint (api.eu.bfl.ai) for GDPR-compliant EU data residency.
 *
 * BFL is a German company (Freiburg i. Br.). The EU endpoint keeps inference
 * routing within EU regions, and generated images are served from EU delivery
 * URLs (delivery-eu.bfl.ai). Holds SOC 2 Type II and ISO 27001.
 *
 * Architecture note — the BFL API is ASYNCHRONOUS:
 *   1. POST /v1/{model}        -> { id, polling_url }
 *   2. GET  polling_url        -> { status, result }   (poll until status === 'Ready')
 *   3. result.sample is an image URL that EXPIRES AFTER 10 MINUTES
 *
 * Because the delivery URL is short-lived, this provider downloads the image
 * and returns base64 by default (robust for consumers). Set
 * providerOptions.returnUrls = true to return the raw (expiring) URL instead.
 *
 * @see https://docs.bfl.ai/api_integration/integration_guidelines
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

interface BflConfig {
  apiKey: string;
  /** Base URL. Defaults to the EU endpoint for GDPR data residency. */
  apiUrl?: string;
}

/** Response of the initial generation POST. */
interface BflSubmitResponse {
  id: string;
  polling_url: string;
}

/** Response of a polling GET against polling_url. */
interface BflPollResponse {
  id: string;
  status: BflStatus;
  result?: {
    sample?: string;
    [key: string]: unknown;
  } | null;
}

type BflStatus =
  | 'Ready'
  | 'Pending'
  | 'Request Moderated'
  | 'Content Moderated'
  | 'Error'
  | 'Task not found';

// ============================================================
// MODEL DEFINITIONS
// ============================================================

/**
 * Maps the middleware model id to the BFL endpoint path segment.
 * The model id and endpoint path are intentionally NOT identical
 * (BFL uses e.g. `flux-pro-1.1`).
 */
const BFL_MODEL_PATHS: Record<string, string> = {
  'flux-1.1-pro': 'flux-pro-1.1',
  'flux-kontext-pro': 'flux-kontext-pro',
  'flux-2-pro': 'flux-2-pro',
};

const BFL_MODELS: ModelInfo[] = [
  {
    id: 'flux-1.1-pro',
    displayName: 'FLUX1.1 [pro]',
    capabilities: {
      textToImage: true,
      // FLUX does NOT support mask-based inpainting; "editing" is prompt-based
      // via reference images on Kontext/FLUX.2, not on 1.1-pro.
      characterConsistency: false,
      imageEditing: false,
      maxImagesPerRequest: 4,
    },
    pricingUrl: 'https://bfl.ai/pricing',
  },
  {
    id: 'flux-kontext-pro',
    displayName: 'FLUX.1 Kontext [pro]',
    capabilities: {
      textToImage: true,
      // Prompt-based editing / character consistency via input_image (single ref).
      characterConsistency: true,
      imageEditing: false, // no mask-based inpainting
      maxImagesPerRequest: 1,
    },
    pricingUrl: 'https://bfl.ai/pricing',
  },
  {
    id: 'flux-2-pro',
    displayName: 'FLUX.2 [pro]',
    capabilities: {
      textToImage: true,
      // Multi-reference editing via input_image / input_image_2 ...
      characterConsistency: true,
      imageEditing: false, // no mask-based inpainting
      maxImagesPerRequest: 1,
    },
    pricingUrl: 'https://bfl.ai/pricing',
  },
];

// ============================================================
// PROVIDER IMPLEMENTATION
// ============================================================

export class BflProvider extends BaseTTIProvider {
  private config: BflConfig;
  private readonly baseUrl: string;

  /** Default EU endpoint — keeps data within EU regions for GDPR compliance. */
  private static readonly DEFAULT_EU_URL = 'https://api.eu.bfl.ai';

  /** Polling defaults (overridable via providerOptions). */
  private static readonly DEFAULT_POLL_INTERVAL_MS = 1500;
  private static readonly DEFAULT_POLL_MAX_WAIT_MS = 120000;

  constructor(config?: Partial<BflConfig>) {
    super(TTIProvider.BFL);

    this.config = {
      apiKey: config?.apiKey || process.env.BFL_API_KEY || '',
      apiUrl: config?.apiUrl || process.env.BFL_API_URL,
    };

    this.baseUrl = (this.config.apiUrl || BflProvider.DEFAULT_EU_URL).replace(/\/+$/, '');

    if (!this.config.apiKey) {
      throw new InvalidConfigError(
        this.providerName,
        'BFL API key is required (BFL_API_KEY)'
      );
    }

    if (!/api\.eu\.bfl\.ai/i.test(this.baseUrl)) {
      this.log(
        'warn',
        `BFL endpoint is not the EU endpoint (${this.baseUrl}). ` +
          'EU data residency is only guaranteed via https://api.eu.bfl.ai'
      );
    }

    this.log('info', 'BFL Provider initialized', { endpoint: this.baseUrl });
  }

  // ============================================================
  // ITTIProvider IMPLEMENTATION
  // ============================================================

  getDisplayName(): string {
    return 'Black Forest Labs (FLUX)';
  }

  listModels(): ModelInfo[] {
    return BFL_MODELS;
  }

  getDefaultModel(): string {
    return 'flux-1.1-pro';
  }

  protected async doGenerate(request: TTIRequest): Promise<TTIResponse> {
    const modelId = request.model || this.getDefaultModel();
    const modelPath = BFL_MODEL_PATHS[modelId];

    if (!modelPath) {
      throw new InvalidConfigError(
        this.providerName,
        `Unknown BFL model '${modelId}'. Available: ${Object.keys(BFL_MODEL_PATHS).join(', ')}`
      );
    }

    const startTime = Date.now();
    const n = request.n && request.n > 0 ? request.n : 1;
    const body = this.buildRequestBody(request, modelId);

    this.log('info', 'Generating image(s) with BFL', { model: modelId, n });

    // BFL produces one image per request — fan out n parallel pipelines.
    // Each pipeline (submit -> poll -> download) is retried independently for
    // transient submit errors via executeWithRetry.
    const tasks = Array.from({ length: n }, () =>
      this.executeWithRetry(
        request,
        () => this.generateSingleImage(modelPath, body, request),
        `BFL ${modelId} generation`
      )
    );

    const images = await Promise.all(tasks);
    const duration = Date.now() - startTime;

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
   * Run a single image pipeline: submit the job, poll until ready, then
   * resolve the resulting image (downloaded to base64 by default).
   *
   * Only the submit step is wrapped by executeWithRetry (transient 429/5xx).
   * Polling has its own bounded loop so a slow generation (e.g. FLUX.2) does
   * not trip the per-attempt retry timeout and trigger a costly re-submit.
   */
  private async generateSingleImage(
    modelPath: string,
    body: Record<string, unknown>,
    request: TTIRequest
  ): Promise<TTIImage> {
    const submit = await this.submitRequest(modelPath, body);
    const sampleUrl = await this.pollForResult(submit.polling_url, request);
    return this.resolveImage(sampleUrl, request);
  }

  /** POST the generation job; returns the polling handle. */
  private async submitRequest(
    modelPath: string,
    body: Record<string, unknown>
  ): Promise<BflSubmitResponse> {
    const url = `${this.baseUrl}/v1/${modelPath}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-key': this.config.apiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw this.handleError(error as Error, 'during BFL submit');
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw this.handleError(
        new Error(`BFL submit error (${response.status}): ${errorText}`),
        'during BFL submit'
      );
    }

    const data = (await response.json()) as BflSubmitResponse;
    if (!data.polling_url) {
      throw new GenerationFailedError(
        this.providerName,
        'BFL submit response did not include a polling_url'
      );
    }

    this.log('debug', 'BFL job submitted', { id: data.id });
    return data;
  }

  /**
   * Poll the polling_url until the job reaches a terminal state.
   * Resolves with the sample image URL on success.
   */
  private async pollForResult(pollingUrl: string, request: TTIRequest): Promise<string> {
    const opts = request.providerOptions || {};
    const intervalMs =
      (opts.pollIntervalMs as number) ?? BflProvider.DEFAULT_POLL_INTERVAL_MS;
    const maxWaitMs =
      (opts.pollMaxWaitMs as number) ?? BflProvider.DEFAULT_POLL_MAX_WAIT_MS;

    const deadline = Date.now() + maxWaitMs;
    let transientPollFailures = 0;

    while (Date.now() < deadline) {
      await this.sleep(intervalMs);

      let data: BflPollResponse;
      try {
        const response = await fetch(pollingUrl, {
          method: 'GET',
          headers: { 'x-key': this.config.apiKey, accept: 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`BFL poll error (${response.status})`);
        }
        data = (await response.json()) as BflPollResponse;
      } catch (error) {
        // Tolerate isolated polling hiccups; keep polling until the deadline.
        transientPollFailures++;
        if (transientPollFailures > 5) {
          throw this.handleError(error as Error, 'during BFL polling');
        }
        this.log('warn', 'Transient BFL polling failure, retrying', {
          attempt: transientPollFailures,
        });
        continue;
      }

      switch (data.status) {
        case 'Ready': {
          const sample = data.result?.sample;
          if (!sample) {
            throw new GenerationFailedError(
              this.providerName,
              'BFL reported Ready but no sample URL was returned'
            );
          }
          this.log('debug', 'BFL job ready', { id: data.id });
          return sample;
        }
        case 'Pending':
          continue;
        case 'Request Moderated':
        case 'Content Moderated':
          throw new GenerationFailedError(
            this.providerName,
            `BFL content moderation blocked the request (status: ${data.status})`
          );
        case 'Error':
        case 'Task not found':
        default:
          throw new GenerationFailedError(
            this.providerName,
            `BFL generation failed (status: ${data.status})`
          );
      }
    }

    throw new GenerationFailedError(
      this.providerName,
      `BFL generation timed out after ${maxWaitMs}ms`
    );
  }

  /**
   * Resolve the final image. By default downloads the (10-min-expiring) URL
   * and returns base64. Set providerOptions.returnUrls = true to keep the URL.
   */
  private async resolveImage(sampleUrl: string, request: TTIRequest): Promise<TTIImage> {
    const returnUrls = request.providerOptions?.returnUrls === true;
    if (returnUrls) {
      return { url: sampleUrl };
    }

    try {
      const response = await fetch(sampleUrl);
      if (!response.ok) {
        throw new Error(`BFL image download error (${response.status})`);
      }
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return { base64, contentType };
    } catch (error) {
      throw this.handleError(error as Error, 'during BFL image download');
    }
  }

  /**
   * Build the BFL request body from the unified request.
   * - flux-1.1-pro / flux-2-pro: width/height derived from aspectRatio
   * - flux-kontext-pro: aspect_ratio passed through as a string
   * - reference images map to input_image, input_image_2, ...
   * - providerOptions act as an escape hatch and override derived fields
   */
  private buildRequestBody(request: TTIRequest, modelId: string): Record<string, unknown> {
    const opts = request.providerOptions || {};
    const outputFormat = (opts.outputFormat as string) || 'jpeg';

    const body: Record<string, unknown> = {
      prompt: request.prompt,
      output_format: outputFormat,
    };

    if (modelId === 'flux-kontext-pro') {
      if (request.aspectRatio) {
        body.aspect_ratio = request.aspectRatio;
      }
    } else {
      const { width, height } = this.aspectRatioToDimensions(request.aspectRatio);
      body.width = width;
      body.height = height;
    }

    // Reference images (character consistency / prompt-based editing).
    const refs = request.referenceImages || [];
    refs.forEach((ref, index) => {
      const key = index === 0 ? 'input_image' : `input_image_${index + 1}`;
      body[key] = ref.base64;
    });

    // Pass-through escape hatch — explicit provider options win.
    // (Strip middleware-only control keys that are not BFL body fields.)
    const reserved = new Set([
      'returnUrls',
      'pollIntervalMs',
      'pollMaxWaitMs',
      'outputFormat',
    ]);
    for (const [key, value] of Object.entries(opts)) {
      if (!reserved.has(key)) {
        body[key] = value;
      }
    }

    return body;
  }

  /** Map an aspect ratio to concrete pixel dimensions (BFL width/height). */
  private aspectRatioToDimensions(aspectRatio?: string): { width: number; height: number } {
    const mapping: Record<string, { width: number; height: number }> = {
      '1:1': { width: 1024, height: 1024 },
      '16:9': { width: 1344, height: 768 },
      '9:16': { width: 768, height: 1344 },
      '4:3': { width: 1152, height: 896 },
      '3:4': { width: 896, height: 1152 },
      '3:2': { width: 1216, height: 832 },
      '2:3': { width: 832, height: 1216 },
    };
    return mapping[aspectRatio || '1:1'] || { width: 1024, height: 1024 };
  }
}
