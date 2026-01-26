/**
 * Base TTI Provider Abstract Class
 *
 * All providers must extend this class and implement the ITTIProvider interface.
 * Provides common functionality for error handling, logging, and validation.
 */

import {
  TTIProvider,
  TTIRequest,
  TTIResponse,
  TTIErrorCode,
  ITTIProvider,
  ModelInfo,
  RetryOptions,
  DEFAULT_RETRY_OPTIONS,
  LogLevel,
  LOG_LEVEL_PRIORITY,
} from '../../../types';
import { TTIDebugger, TTIDebugInfo } from '../utils/debug-tti.utils';
import {
  DRY_MODE_PLACEHOLDER_IMAGE,
  DRY_MODE_PLACEHOLDER_MIME_TYPE,
} from '../assets/placeholder-image';

// ============================================================
// ERROR CLASSES
// ============================================================

export class TTIError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: TTIErrorCode,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'TTIError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TTIError);
    }
  }

  toString(): string {
    return `[${this.provider}] ${this.code}: ${this.message}${
      this.cause ? ` (caused by: ${this.cause.message})` : ''
    }`;
  }
}

export class InvalidConfigError extends TTIError {
  constructor(provider: string, message: string, cause?: Error) {
    super(provider, 'INVALID_CONFIG', message, cause);
    this.name = 'InvalidConfigError';
  }
}

export class QuotaExceededError extends TTIError {
  constructor(provider: string, message?: string, cause?: Error) {
    super(
      provider,
      'QUOTA_EXCEEDED',
      message || 'Provider quota or rate limit exceeded',
      cause
    );
    this.name = 'QuotaExceededError';
  }
}

export class ProviderUnavailableError extends TTIError {
  constructor(provider: string, message?: string, cause?: Error) {
    super(
      provider,
      'PROVIDER_UNAVAILABLE',
      message || 'Provider service is temporarily unavailable',
      cause
    );
    this.name = 'ProviderUnavailableError';
  }
}

export class GenerationFailedError extends TTIError {
  constructor(provider: string, message: string, cause?: Error) {
    super(provider, 'GENERATION_FAILED', message, cause);
    this.name = 'GenerationFailedError';
  }
}

export class NetworkError extends TTIError {
  constructor(provider: string, message: string, cause?: Error) {
    super(provider, 'NETWORK_ERROR', message, cause);
    this.name = 'NetworkError';
  }
}

export class CapabilityNotSupportedError extends TTIError {
  constructor(provider: string, capability: string, model: string, cause?: Error) {
    super(
      provider,
      'CAPABILITY_NOT_SUPPORTED',
      `Model '${model}' does not support '${capability}'`,
      cause
    );
    this.name = 'CapabilityNotSupportedError';
  }
}

// ============================================================
// BASE PROVIDER CLASS
// ============================================================

/**
 * Global log level for all providers
 * Set via TTI_LOG_LEVEL environment variable or setLogLevel()
 */
let globalLogLevel: LogLevel = (process.env.TTI_LOG_LEVEL as LogLevel) || 'info';

/**
 * Set the global log level for all TTI providers
 */
export function setLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

/**
 * Get the current global log level
 */
export function getLogLevel(): LogLevel {
  return globalLogLevel;
}

export abstract class BaseTTIProvider implements ITTIProvider {
  protected readonly providerName: TTIProvider;

  constructor(providerName: TTIProvider) {
    this.providerName = providerName;
  }

  // ============================================================
  // ABSTRACT METHODS (must be implemented by subclasses)
  // ============================================================

  abstract getDisplayName(): string;
  abstract listModels(): ModelInfo[];
  abstract getDefaultModel(): string;

  /**
   * Provider-specific generation implementation.
   * Called by generate() after validation and dry mode checks.
   * Subclasses should implement the actual API call logic here.
   */
  protected abstract doGenerate(request: TTIRequest): Promise<TTIResponse>;

  // ============================================================
  // IMPLEMENTED METHODS
  // ============================================================

  public getName(): TTIProvider {
    return this.providerName;
  }

  /**
   * Generate images from a request.
   * This is the main entry point that handles:
   * - Request validation
   * - Dry mode (skip API call, return mock response with logging)
   * - Delegation to provider-specific doGenerate()
   *
   * Note: Normal mode logging is handled by each provider in doGenerate()
   * to support provider-specific metadata (e.g., region for Google Cloud).
   */
  public async generate(request: TTIRequest): Promise<TTIResponse> {
    // 1. Validate the request
    this.validateRequest(request);

    // 2. Handle dry mode - skip API call, return mock response
    if (request.dry) {
      return this.handleDryMode(request);
    }

    // 3. Execute actual generation via provider-specific implementation
    // Provider handles its own logging with provider-specific metadata
    return this.doGenerate(request);
  }

  /**
   * Handle dry mode: log request and return mock response without API call.
   * Useful for development and debugging without incurring API costs.
   */
  protected async handleDryMode(request: TTIRequest): Promise<TTIResponse> {
    const modelId = request.model || this.getDefaultModel();

    this.log('info', 'Dry mode enabled - skipping API call', {
      model: modelId,
      provider: this.providerName,
    });

    // Create debug info for logging (if enabled)
    let debugInfo: TTIDebugInfo | null = null;
    if (TTIDebugger.isEnabled) {
      debugInfo = TTIDebugger.createDebugInfo(request, this.providerName, modelId);
      await TTIDebugger.logRequest(debugInfo);
    }

    const dryResponse = this.createDryModeResponse(request, modelId);

    if (debugInfo) {
      debugInfo = TTIDebugger.updateWithResponse(debugInfo, dryResponse);
      await TTIDebugger.logResponse(debugInfo);
    }

    return dryResponse;
  }

  /**
   * Create a mock response for dry mode.
   * Returns placeholder images (white 1024x1024 PNG) with metadata.
   */
  protected createDryModeResponse(request: TTIRequest, modelId: string): TTIResponse {
    const imageCount = request.n || 1;

    // Generate the requested number of placeholder images
    const images = Array.from({ length: imageCount }, () => ({
      base64: DRY_MODE_PLACEHOLDER_IMAGE,
      contentType: DRY_MODE_PLACEHOLDER_MIME_TYPE,
    }));

    return {
      images,
      metadata: {
        provider: this.providerName,
        model: modelId,
        duration: 0,
      },
      usage: {
        imagesGenerated: imageCount,
        modelId: modelId,
      },
    };
  }

  /**
   * Get model info by ID
   */
  protected getModelInfo(modelId: string): ModelInfo | undefined {
    return this.listModels().find((m) => m.id === modelId);
  }

  /**
   * Check if a model supports a specific capability
   */
  protected modelSupportsCapability(
    modelId: string,
    capability: keyof ModelInfo['capabilities']
  ): boolean {
    const model = this.getModelInfo(modelId);
    if (!model) return false;
    return model.capabilities[capability] as boolean;
  }

  /**
   * Validate that the request is valid
   */
  protected validateRequest(request: TTIRequest): void {
    if (!request.prompt || request.prompt.trim().length === 0) {
      throw new InvalidConfigError(this.providerName, 'Prompt cannot be empty');
    }

    // If reference images are provided, validate them
    if (request.referenceImages && request.referenceImages.length > 0) {
      const modelId = request.model || this.getDefaultModel();

      // Check if model supports character consistency
      if (!this.modelSupportsCapability(modelId, 'characterConsistency')) {
        throw new CapabilityNotSupportedError(
          this.providerName,
          'characterConsistency',
          modelId
        );
      }

      // Validate subject description is provided
      // RELAXED: We now allow missing subjectDescription to support raw multimodal prompting
      // where the user references images directly in the prompt (e.g., "Image 1 is X...").
      // if (!request.subjectDescription || request.subjectDescription.trim().length === 0) {
      //   throw new InvalidConfigError(
      //     this.providerName,
      //     'subjectDescription is required when using referenceImages'
      //   );
      // }

      // Validate reference images have data
      for (let i = 0; i < request.referenceImages.length; i++) {
        const ref = request.referenceImages[i];
        if (!ref.base64 || ref.base64.trim().length === 0) {
          throw new InvalidConfigError(
            this.providerName,
            `Reference image at index ${i} has empty base64 data`
          );
        }
      }
    }
  }

  // ============================================================
  // RETRY LOGIC
  // ============================================================

  /**
   * Resolve retry configuration from request
   */
  protected resolveRetryConfig(request: TTIRequest): Required<RetryOptions> | null {
    const retryOption = request.retry;

    // Explicit disable
    if (retryOption === false) {
      return null;
    }

    // Default (undefined) or explicit true: use defaults
    if (retryOption === undefined || retryOption === true) {
      return { ...DEFAULT_RETRY_OPTIONS };
    }

    // Custom configuration: merge with defaults
    return {
      maxRetries: retryOption.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries,
      delayMs: retryOption.delayMs ?? DEFAULT_RETRY_OPTIONS.delayMs,
      incrementalBackoff: retryOption.incrementalBackoff ?? DEFAULT_RETRY_OPTIONS.incrementalBackoff,
    };
  }

  /**
   * Calculate delay for a specific retry attempt
   */
  protected calculateRetryDelay(
    attempt: number,
    config: Required<RetryOptions>
  ): number {
    if (config.incrementalBackoff) {
      // Incremental: 1s, 2s, 3s, ...
      return config.delayMs * attempt;
    }
    // Static: always same delay
    return config.delayMs;
  }

  /**
   * Sleep for a specified duration
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute a generation function with retry logic for rate limits
   */
  protected async executeWithRetry<T>(
    request: TTIRequest,
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const retryConfig = this.resolveRetryConfig(request);

    // No retry configured
    if (!retryConfig) {
      return operation();
    }

    let lastError: Error | null = null;
    const maxAttempts = 1 + retryConfig.maxRetries; // initial + retries

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Check if this is a rate limit error (429)
        const isRateLimitError = this.isRateLimitError(error as Error);

        // Only retry on rate limit errors
        if (!isRateLimitError) {
          throw error;
        }

        // Check if we have retries left
        if (attempt < maxAttempts) {
          const delay = this.calculateRetryDelay(attempt, retryConfig);
          this.log(
            'warn',
            `Rate limit hit during ${operationName}. Retry ${attempt}/${retryConfig.maxRetries} in ${delay}ms...`,
            { attempt, maxRetries: retryConfig.maxRetries, delayMs: delay }
          );
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    throw lastError;
  }

  /**
   * Check if an error is a rate limit error (429)
   */
  protected isRateLimitError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('quota exceeded') ||
      message.includes('too many requests') ||
      message.includes('resource exhausted')
    );
  }

  /**
   * Convert errors to TTIError instances with proper classification
   */
  protected handleError(error: Error, context?: string): TTIError {
    if (error instanceof TTIError) {
      return error;
    }

    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes('401') || errorMessage.includes('403')) {
      return new InvalidConfigError(
        this.providerName,
        `Authentication failed${context ? `: ${context}` : ''}`,
        error
      );
    }

    if (errorMessage.includes('429')) {
      return new QuotaExceededError(
        this.providerName,
        `Rate limit exceeded${context ? `: ${context}` : ''}`,
        error
      );
    }

    if (
      errorMessage.includes('503') ||
      errorMessage.includes('504') ||
      errorMessage.includes('502')
    ) {
      return new ProviderUnavailableError(
        this.providerName,
        `Service temporarily unavailable${context ? `: ${context}` : ''}`,
        error
      );
    }

    if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('enotfound')
    ) {
      return new NetworkError(
        this.providerName,
        `Network error${context ? `: ${context}` : ''}`,
        error
      );
    }

    return new GenerationFailedError(
      this.providerName,
      `Generation failed${context ? `: ${context}` : ''}: ${error.message}`,
      error
    );
  }

  /**
   * Log messages with provider context
   * Respects global log level setting
   */
  protected log(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    meta?: Record<string, unknown>
  ): void {
    // Check if we should log this level
    const currentPriority = LOG_LEVEL_PRIORITY[level];
    const minPriority = LOG_LEVEL_PRIORITY[globalLogLevel];

    if (currentPriority < minPriority) {
      return; // Skip logging if below minimum level
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${this.providerName.toUpperCase()}] [${level.toUpperCase()}]`;

    if (meta) {
      console[level](prefix, message, meta);
    } else {
      console[level](prefix, message);
    }
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Type guard to check if a request includes reference images
 */
export function hasReferenceImages(request: TTIRequest): boolean {
  return (
    request.referenceImages !== undefined &&
    Array.isArray(request.referenceImages) &&
    request.referenceImages.length > 0
  );
}

/**
 * Check if a region is EU-compliant for GDPR purposes
 */
export function isEURegion(region: string): boolean {
  const euRegions = [
    'europe-west1',
    'europe-west2',
    'europe-west3',
    'europe-west4',
    'europe-west9',
    'europe-north1',
    'europe-central2',
  ];
  return euRegions.includes(region);
}
