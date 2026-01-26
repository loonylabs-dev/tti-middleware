// ============================================================
// PROVIDER IDENTIFICATION
// ============================================================

/**
 * Available TTI Providers
 * Each provider represents a single backend/contract partner with one DPA
 */
export enum TTIProvider {
  /** Google Cloud Platform (Vertex AI) - includes Imagen and Gemini models. RECOMMENDED for EU/GDPR. */
  GOOGLE_CLOUD = 'google-cloud',
  /** Eden AI - aggregator with multiple underlying models. EXPERIMENTAL - limited testing. */
  EDENAI = 'edenai',
  /** IONOS Cloud. EXPERIMENTAL - limited testing. */
  IONOS = 'ionos',
}

// ============================================================
// LOGGING CONFIGURATION
// ============================================================

/**
 * Log levels for provider logging
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Log level priority (higher = more severe)
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// ============================================================
// MODEL CAPABILITIES
// ============================================================

/**
 * Capabilities of a specific model
 */
export interface TTICapabilities {
  /** Basic text-to-image generation */
  textToImage: boolean;
  /** Character consistency via reference images */
  characterConsistency: boolean;
  /** Image editing (inpainting, outpainting) - future */
  imageEditing: boolean;
  /** Maximum images per request */
  maxImagesPerRequest: number;
}

/**
 * Information about a specific model within a provider
 */
export interface ModelInfo {
  /** Internal model ID used in API calls */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** What the model can do */
  capabilities: TTICapabilities;
  /** Available regions (for providers with regional endpoints) */
  availableRegions?: string[];
  /** Link to official pricing page */
  pricingUrl?: string;
}

// ============================================================
// REGIONS (Google Cloud specific)
// ============================================================

/**
 * Google Cloud regions
 * EU regions are GDPR-compliant
 */
export type GoogleCloudRegion =
  | 'europe-west1'   // Belgium
  | 'europe-west2'   // London, UK
  | 'europe-west3'   // Frankfurt, Germany
  | 'europe-west4'   // Netherlands
  | 'europe-west9'   // Paris, France
  | 'us-central1'    // Iowa (NOT EU-compliant)
  | 'us-east4';      // Virginia (NOT EU-compliant)

// ============================================================
// REQUEST & RESPONSE
// ============================================================

/**
 * Reference image for character consistency
 */
export interface TTIReferenceImage {
  /** Base64-encoded image data */
  base64: string;
  /** MIME type of the image (e.g., 'image/png', 'image/jpeg') */
  mimeType?: string;
}

/**
 * Unified TTI generation request
 * Works for both simple text-to-image and character consistency
 */
export interface TTIRequest {
  /** The text prompt describing what to generate */
  prompt: string;

  // Model selection
  /** Model ID to use (provider-specific, e.g., 'imagen-3', 'gemini-flash-image') */
  model?: string;

  // Basic options
  /** Number of images to generate (default: 1) */
  n?: number;
  /** Aspect ratio (e.g., '1:1', '16:9', '4:3') */
  aspectRatio?: string;

  // Character consistency (optional)
  /**
   * Reference images for character consistency
   * If provided, the model will try to maintain visual consistency
   */
  referenceImages?: TTIReferenceImage[];
  /**
   * Description of the subject in reference images
   * Required when using referenceImages (e.g., "cute cartoon bear with red hat")
   */
  subjectDescription?: string;

  // Provider-specific options (escape hatch)
  /** Additional provider-specific options */
  providerOptions?: Record<string, unknown>;

  // Retry configuration
  /**
   * Retry configuration for rate limit errors (429)
   * - true: use default retry (2 retries, 1s delay)
   * - false: disable retry
   * - RetryOptions: custom configuration
   * Default: true (retry enabled with defaults)
   */
  retry?: boolean | RetryOptions;

  // Development/debugging
  /**
   * Dry mode - validate and log request without making actual API calls.
   * Useful for development and debugging without incurring API costs.
   * When enabled:
   * - Request is validated as normal
   * - Request is logged via TTIDebugger (if enabled)
   * - A mock response is returned (no actual image generation)
   * Default: false
   */
  dry?: boolean;
}

/**
 * Generated image
 */
export interface TTIImage {
  /** URL to the generated image (if available) */
  url?: string;
  /** Base64-encoded image data */
  base64?: string;
  /** MIME type (e.g., 'image/png', 'image/jpeg') */
  contentType?: string;
}

/**
 * Usage metrics for a generation request
 */
export interface TTIUsage {
  /** Number of images generated */
  imagesGenerated: number;
  /** Size of generated images */
  imageSize?: string;
  /** Model used for generation */
  modelId: string;
  /** Input tokens (for token-based models) */
  inputTokens?: number;
  /** Output tokens (for token-based models) */
  outputTokens?: number;
}

/**
 * Billing information (only if provider returns it)
 */
export interface TTIBilling {
  /** Cost of the request */
  cost: number;
  /** Currency */
  currency: string;
  /** Source of the cost information */
  source: 'provider' | 'estimated';
}

/**
 * Response from a TTI generation request
 */
export interface TTIResponse {
  /** Generated images */
  images: TTIImage[];

  /** Request metadata */
  metadata: {
    /** Provider that handled the request */
    provider: string;
    /** Model used */
    model: string;
    /** Region where request was processed (if applicable) */
    region?: string;
    /** Request duration in milliseconds */
    duration: number;
  };

  /** Usage metrics */
  usage: TTIUsage;

  /** Billing info (only if provider returns actual costs) */
  billing?: TTIBilling;
}

// ============================================================
// ERROR HANDLING
// ============================================================

export type TTIErrorCode =
  | 'INVALID_CONFIG'
  | 'QUOTA_EXCEEDED'
  | 'PROVIDER_UNAVAILABLE'
  | 'GENERATION_FAILED'
  | 'NETWORK_ERROR'
  | 'UNAUTHORIZED'
  | 'CAPABILITY_NOT_SUPPORTED';

// ============================================================
// RETRY CONFIGURATION
// ============================================================

/**
 * Configuration for retry behavior on rate limits (429 errors)
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts (default: 2)
   * Total attempts = 1 (initial) + maxRetries
   */
  maxRetries?: number;

  /**
   * Base delay between retries in milliseconds (default: 1000)
   */
  delayMs?: number;

  /**
   * Use incremental backoff: delay increases by delayMs each retry
   * false: always wait delayMs (e.g., 1s, 1s, 1s)
   * true: wait delayMs * attempt (e.g., 1s, 2s, 3s)
   * Default: false
   */
  incrementalBackoff?: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 2,
  delayMs: 1000,
  incrementalBackoff: false,
};

// ============================================================
// PROVIDER INTERFACE
// ============================================================

/**
 * Interface that all TTI providers must implement
 */
export interface ITTIProvider {
  // Identity
  /** Get the provider identifier */
  getName(): TTIProvider;
  /** Get human-readable display name */
  getDisplayName(): string;

  // Models
  /** List all available models */
  listModels(): ModelInfo[];
  /** Get the default model ID */
  getDefaultModel(): string;

  // Generation
  /** Generate images from a request */
  generate(request: TTIRequest): Promise<TTIResponse>;
}

