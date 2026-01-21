/**
 * Unit Tests for TTIService
 *
 * Tests the main service orchestration including:
 * - Provider registration
 * - Provider selection and fallback
 * - Generation routing
 * - Model listing
 */

import { TTIService } from '../../../src/middleware/services/tti/tti.service';
import { BaseTTIProvider } from '../../../src/middleware/services/tti/providers/base-tti-provider';
import {
  TTIProvider,
  TTIRequest,
  TTIResponse,
  ModelInfo,
} from '../../../src/middleware/types';

// ============================================================
// MOCK PROVIDERS
// ============================================================

/**
 * Create a mock provider for testing
 */
function createMockProvider(
  name: TTIProvider,
  displayName: string,
  models: ModelInfo[] = []
): BaseTTIProvider {
  const defaultModels: ModelInfo[] = [
    {
      id: 'mock-model',
      displayName: 'Mock Model',
      capabilities: {
        textToImage: true,
        characterConsistency: false,
        imageEditing: false,
        maxImagesPerRequest: 4,
      },
    },
  ];

  return {
    getName: () => name,
    getDisplayName: () => displayName,
    listModels: () => (models.length > 0 ? models : defaultModels),
    getDefaultModel: () => (models.length > 0 ? models[0].id : 'mock-model'),
    generate: jest.fn().mockResolvedValue({
      images: [{ base64: 'mock-image-data', contentType: 'image/png' }],
      metadata: { provider: name, model: 'mock-model', duration: 100 },
      usage: { imagesGenerated: 1, modelId: 'mock-model' },
    } as TTIResponse),
  } as unknown as BaseTTIProvider;
}

// ============================================================
// TESTS
// ============================================================

describe('TTIService', () => {
  let service: TTIService;

  beforeEach(() => {
    // Clear any environment variables that might affect tests
    delete process.env.TTI_DEFAULT_PROVIDER;
    service = new TTIService();
  });

  describe('constructor', () => {
    it('should create with default provider', () => {
      expect(service.getDefaultProvider()).toBe(TTIProvider.GOOGLE_CLOUD);
    });

    it('should respect TTI_DEFAULT_PROVIDER environment variable', () => {
      process.env.TTI_DEFAULT_PROVIDER = 'edenai';
      const envService = new TTIService();
      expect(envService.getDefaultProvider()).toBe(TTIProvider.EDENAI);
    });

    it('should handle various provider name formats from env', () => {
      const formats = [
        ['google-cloud', TTIProvider.GOOGLE_CLOUD],
        ['google_cloud', TTIProvider.GOOGLE_CLOUD],
        ['googlecloud', TTIProvider.GOOGLE_CLOUD],
        ['vertex_ai', TTIProvider.GOOGLE_CLOUD], // Legacy
        ['gemini', TTIProvider.GOOGLE_CLOUD], // Legacy
        ['edenai', TTIProvider.EDENAI],
        ['eden_ai', TTIProvider.EDENAI],
        ['ionos', TTIProvider.IONOS],
      ];

      for (const [envValue, expected] of formats) {
        process.env.TTI_DEFAULT_PROVIDER = envValue as string;
        const testService = new TTIService();
        expect(testService.getDefaultProvider()).toBe(expected);
      }
    });
  });

  describe('registerProvider()', () => {
    it('should register a provider', () => {
      const mockProvider = createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google Cloud');
      service.registerProvider(mockProvider);

      expect(service.isProviderAvailable(TTIProvider.GOOGLE_CLOUD)).toBe(true);
    });

    it('should allow registering multiple providers', () => {
      service.registerProvider(createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google Cloud'));
      service.registerProvider(createMockProvider(TTIProvider.EDENAI, 'Eden AI'));
      service.registerProvider(createMockProvider(TTIProvider.IONOS, 'IONOS'));

      expect(service.getAvailableProviders()).toHaveLength(3);
    });

    it('should overwrite existing provider with same name', () => {
      const provider1 = createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Provider 1');
      const provider2 = createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Provider 2');

      service.registerProvider(provider1);
      service.registerProvider(provider2);

      expect(service.getProvider(TTIProvider.GOOGLE_CLOUD)?.getDisplayName()).toBe('Provider 2');
    });
  });

  describe('getProvider()', () => {
    it('should return registered provider', () => {
      const mockProvider = createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google Cloud');
      service.registerProvider(mockProvider);

      const retrieved = service.getProvider(TTIProvider.GOOGLE_CLOUD);
      expect(retrieved).toBe(mockProvider);
    });

    it('should return undefined for unregistered provider', () => {
      expect(service.getProvider(TTIProvider.EDENAI)).toBeUndefined();
    });
  });

  describe('getAvailableProviders()', () => {
    it('should return empty array when no providers registered', () => {
      expect(service.getAvailableProviders()).toEqual([]);
    });

    it('should return all registered provider names', () => {
      service.registerProvider(createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google'));
      service.registerProvider(createMockProvider(TTIProvider.EDENAI, 'Eden'));

      const providers = service.getAvailableProviders();
      expect(providers).toContain(TTIProvider.GOOGLE_CLOUD);
      expect(providers).toContain(TTIProvider.EDENAI);
    });
  });

  describe('isProviderAvailable()', () => {
    it('should return true for registered provider', () => {
      service.registerProvider(createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google'));
      expect(service.isProviderAvailable(TTIProvider.GOOGLE_CLOUD)).toBe(true);
    });

    it('should return false for unregistered provider', () => {
      expect(service.isProviderAvailable(TTIProvider.IONOS)).toBe(false);
    });
  });

  describe('setDefaultProvider()', () => {
    it('should set default provider', () => {
      service.setDefaultProvider(TTIProvider.EDENAI);
      expect(service.getDefaultProvider()).toBe(TTIProvider.EDENAI);
    });

    it('should allow setting unregistered provider with warning', () => {
      // Should not throw, just warn
      expect(() => {
        service.setDefaultProvider(TTIProvider.IONOS);
      }).not.toThrow();
      expect(service.getDefaultProvider()).toBe(TTIProvider.IONOS);
    });
  });

  describe('listAllModels()', () => {
    it('should return empty array when no providers registered', () => {
      expect(service.listAllModels()).toEqual([]);
    });

    it('should return models from all providers', () => {
      const googleModels: ModelInfo[] = [
        {
          id: 'imagen-3',
          displayName: 'Imagen 3',
          capabilities: {
            textToImage: true,
            characterConsistency: false,
            imageEditing: false,
            maxImagesPerRequest: 4,
          },
        },
        {
          id: 'gemini-flash',
          displayName: 'Gemini Flash',
          capabilities: {
            textToImage: true,
            characterConsistency: true,
            imageEditing: false,
            maxImagesPerRequest: 1,
          },
        },
      ];

      const edenModels: ModelInfo[] = [
        {
          id: 'openai',
          displayName: 'OpenAI DALL-E',
          capabilities: {
            textToImage: true,
            characterConsistency: false,
            imageEditing: false,
            maxImagesPerRequest: 4,
          },
        },
      ];

      service.registerProvider(createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google', googleModels));
      service.registerProvider(createMockProvider(TTIProvider.EDENAI, 'Eden', edenModels));

      const allModels = service.listAllModels();
      expect(allModels).toHaveLength(2);

      const googleEntry = allModels.find((e) => e.provider === TTIProvider.GOOGLE_CLOUD);
      expect(googleEntry?.models).toHaveLength(2);

      const edenEntry = allModels.find((e) => e.provider === TTIProvider.EDENAI);
      expect(edenEntry?.models).toHaveLength(1);
    });
  });

  describe('findProvidersWithCapability()', () => {
    beforeEach(() => {
      const googleModels: ModelInfo[] = [
        {
          id: 'gemini-flash',
          displayName: 'Gemini Flash',
          capabilities: {
            textToImage: true,
            characterConsistency: true,
            imageEditing: false,
            maxImagesPerRequest: 1,
          },
        },
      ];

      const edenModels: ModelInfo[] = [
        {
          id: 'openai',
          displayName: 'OpenAI',
          capabilities: {
            textToImage: true,
            characterConsistency: false,
            imageEditing: false,
            maxImagesPerRequest: 4,
          },
        },
      ];

      service.registerProvider(createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google', googleModels));
      service.registerProvider(createMockProvider(TTIProvider.EDENAI, 'Eden', edenModels));
    });

    it('should find providers with characterConsistency', () => {
      const providers = service.findProvidersWithCapability('characterConsistency');
      expect(providers).toHaveLength(1);
      expect(providers[0].provider).toBe(TTIProvider.GOOGLE_CLOUD);
    });

    it('should find providers with textToImage', () => {
      const providers = service.findProvidersWithCapability('textToImage');
      expect(providers).toHaveLength(2);
    });

    it('should return empty when no provider has capability', () => {
      const providers = service.findProvidersWithCapability('imageEditing');
      expect(providers).toHaveLength(0);
    });
  });

  describe('generate()', () => {
    it('should generate with default provider', async () => {
      const mockProvider = createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google');
      service.registerProvider(mockProvider);

      const result = await service.generate({ prompt: 'test image' });

      expect(result.images).toHaveLength(1);
      expect(mockProvider.generate).toHaveBeenCalledWith({ prompt: 'test image' });
    });

    it('should generate with specified provider', async () => {
      const googleProvider = createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google');
      const edenProvider = createMockProvider(TTIProvider.EDENAI, 'Eden');

      service.registerProvider(googleProvider);
      service.registerProvider(edenProvider);

      await service.generate({ prompt: 'test' }, TTIProvider.EDENAI);

      expect(edenProvider.generate).toHaveBeenCalled();
      expect(googleProvider.generate).not.toHaveBeenCalled();
    });

    it('should fallback to any registered provider when requested not available', async () => {
      const googleProvider = createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google');
      service.registerProvider(googleProvider);

      // Request EDENAI but only GOOGLE_CLOUD is registered
      const result = await service.generate({ prompt: 'test' }, TTIProvider.EDENAI);

      expect(result.images).toHaveLength(1);
      expect(googleProvider.generate).toHaveBeenCalled();
    });

    it('should throw when no providers registered', async () => {
      await expect(service.generate({ prompt: 'test' })).rejects.toThrow();
    });
  });

  describe('legacy methods', () => {
    beforeEach(() => {
      service.registerProvider(createMockProvider(TTIProvider.GOOGLE_CLOUD, 'Google'));
    });

    it('generateImage() should work as alias for generate()', async () => {
      const result = await service.generateImage({ prompt: 'test' });
      expect(result.images).toHaveLength(1);
    });

    it('generateImage() should accept string provider', async () => {
      const result = await service.generateImage({ prompt: 'test' }, 'google-cloud');
      expect(result.images).toHaveLength(1);
    });

    it('generateWithReference() should work as alias for generate()', async () => {
      const result = await service.generateWithReference({
        prompt: 'test',
        referenceImages: [{ base64: 'data' }],
        subjectDescription: 'test subject',
      });
      expect(result.images).toHaveLength(1);
    });
  });
});
