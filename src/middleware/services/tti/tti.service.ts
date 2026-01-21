/**
 * TTI Service
 *
 * Main entry point for Text-to-Image generation.
 * Manages providers and routes requests to the appropriate provider.
 */

import { BaseTTIProvider, InvalidConfigError } from './providers';
import {
  TTIRequest,
  TTIResponse,
  TTIProvider,
  ITTIProvider,
  ModelInfo,
} from '../../types';

export class TTIService {
  private providers: Map<TTIProvider, BaseTTIProvider> = new Map();
  private defaultProvider: TTIProvider = TTIProvider.GOOGLE_CLOUD;

  constructor() {
    // Check for default provider from environment
    const envDefault = process.env.TTI_DEFAULT_PROVIDER?.toLowerCase();
    if (envDefault) {
      const parsed = this.parseProvider(envDefault);
      if (parsed) {
        this.defaultProvider = parsed;
      }
    }
  }

  /**
   * Parse a string to TTIProvider enum
   */
  private parseProvider(value: string): TTIProvider | null {
    const normalized = value.toLowerCase().trim();
    const providerMap: Record<string, TTIProvider> = {
      // Google Cloud
      'google-cloud': TTIProvider.GOOGLE_CLOUD,
      'google_cloud': TTIProvider.GOOGLE_CLOUD,
      googlecloud: TTIProvider.GOOGLE_CLOUD,
      // Legacy names (backwards compatibility)
      vertex_ai: TTIProvider.GOOGLE_CLOUD,
      vertexai: TTIProvider.GOOGLE_CLOUD,
      vertex: TTIProvider.GOOGLE_CLOUD,
      gemini: TTIProvider.GOOGLE_CLOUD,
      // Eden AI
      edenai: TTIProvider.EDENAI,
      eden_ai: TTIProvider.EDENAI,
      // IONOS
      ionos: TTIProvider.IONOS,
    };
    return providerMap[normalized] || null;
  }

  /**
   * Register a TTI provider
   */
  registerProvider(provider: BaseTTIProvider): void {
    this.providers.set(provider.getName(), provider);
    console.log(`[TTIService] Registered provider: ${provider.getDisplayName()}`);
  }

  /**
   * Get a registered provider
   */
  getProvider(name: TTIProvider): BaseTTIProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all registered providers
   */
  getAvailableProviders(): TTIProvider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is available
   */
  isProviderAvailable(provider: TTIProvider): boolean {
    return this.providers.has(provider);
  }

  /**
   * Get the default provider
   */
  getDefaultProvider(): TTIProvider {
    return this.defaultProvider;
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(provider: TTIProvider): void {
    if (!this.providers.has(provider)) {
      console.warn(
        `[TTIService] Provider ${provider} is not registered. Setting as default anyway.`
      );
    }
    this.defaultProvider = provider;
  }

  /**
   * List all models available across all registered providers
   */
  listAllModels(): Array<{ provider: TTIProvider; models: ModelInfo[] }> {
    const result: Array<{ provider: TTIProvider; models: ModelInfo[] }> = [];

    for (const [name, provider] of this.providers) {
      result.push({
        provider: name,
        models: provider.listModels(),
      });
    }

    return result;
  }

  /**
   * Find providers that support a specific capability
   */
  findProvidersWithCapability(
    capability: keyof ModelInfo['capabilities']
  ): Array<{ provider: TTIProvider; models: ModelInfo[] }> {
    const result: Array<{ provider: TTIProvider; models: ModelInfo[] }> = [];

    for (const [name, provider] of this.providers) {
      const supportingModels = provider
        .listModels()
        .filter((m) => m.capabilities[capability]);

      if (supportingModels.length > 0) {
        result.push({
          provider: name,
          models: supportingModels,
        });
      }
    }

    return result;
  }

  /**
   * Generate an image
   *
   * @param request The generation request
   * @param provider Optional provider to use (defaults to default provider)
   */
  async generate(request: TTIRequest, provider?: TTIProvider): Promise<TTIResponse> {
    const providerKey = provider || this.defaultProvider;
    const providerInstance = this.providers.get(providerKey);

    if (!providerInstance) {
      // Try to find any registered provider as fallback
      if (this.providers.size > 0) {
        const entries = Array.from(this.providers.entries());
        const [fallbackKey, fallbackProvider] = entries[0];
        console.warn(
          `[TTIService] Provider ${providerKey} not found. Using fallback: ${fallbackKey}`
        );
        return fallbackProvider.generate(request);
      }

      throw new InvalidConfigError(
        'TTIService',
        `Provider '${providerKey}' not found and no other providers registered.`
      );
    }

    return providerInstance.generate(request);
  }

  // ============================================================
  // LEGACY METHODS (deprecated, for backwards compatibility)
  // ============================================================

  /**
   * @deprecated Use generate() instead
   */
  async generateImage(
    request: TTIRequest,
    provider?: TTIProvider | string
  ): Promise<TTIResponse> {
    const providerKey =
      typeof provider === 'string'
        ? this.parseProvider(provider) || this.defaultProvider
        : provider || this.defaultProvider;

    return this.generate(request, providerKey);
  }

  /**
   * @deprecated Use generate() with referenceImages in request instead
   */
  async generateWithReference(
    request: TTIRequest,
    provider?: TTIProvider | string
  ): Promise<TTIResponse> {
    const providerKey =
      typeof provider === 'string'
        ? this.parseProvider(provider) || this.defaultProvider
        : provider || this.defaultProvider;

    return this.generate(request, providerKey);
  }
}
