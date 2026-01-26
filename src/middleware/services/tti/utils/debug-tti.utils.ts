/**
 * TTI Debugger Utility
 *
 * Provides markdown-based logging for TTI requests, similar to LLM middleware.
 * Logs prompts, subject descriptions, reference image metadata, and responses.
 *
 * Enable via:
 * - Environment variable: DEBUG_TTI_REQUESTS=true
 * - Or programmatically: TTIDebugger.setEnabled(true)
 *
 * Configure log directory:
 * - Environment variable: TTI_DEBUG_LOG_DIR=/path/to/logs
 * - Or programmatically: TTIDebugger.setLogsDir('/path/to/logs')
 * - Default: process.cwd()/logs/tti/requests/
 */

import * as fs from 'fs';
import * as path from 'path';
import { TTIRequest, TTIResponse } from '../../../types';

// ============================================================
// TYPES
// ============================================================

/**
 * Debug information for a TTI request
 */
export interface TTIDebugInfo {
  // Request metadata
  requestTimestamp: Date;
  responseTimestamp?: Date;

  // Provider info
  provider: string;
  model: string;
  region?: string;

  // Request data
  prompt: string;
  subjectDescription?: string;
  referenceImageCount: number;
  referenceImageMimeTypes?: string[];
  aspectRatio?: string;
  providerOptions?: Record<string, unknown>;

  // Tracking
  useCase?: string;
  sessionId?: string;
  bookId?: string;
  characterId?: string;
  sectionId?: string;

  // Response data (populated after generation)
  response?: {
    imageCount: number;
    imageMimeTypes: string[];
    duration: number;
  };

  // Raw data for debugging
  rawRequest?: TTIRequest;
  rawResponse?: TTIResponse;

  // Error (if any)
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

/**
 * Configuration options for TTIDebugger
 */
export interface TTIDebuggerConfig {
  /** Enable/disable logging (default: from DEBUG_TTI_REQUESTS env) */
  enabled?: boolean;
  /** Directory for log files (default: process.cwd()/logs/tti/requests) */
  logsDir?: string;
  /** Include raw base64 image data in logs (default: false - too large) */
  includeBase64?: boolean;
  /** Log to console as well (default: false) */
  consoleLog?: boolean;
}

// ============================================================
// DEBUGGER CLASS
// ============================================================

/**
 * Static debugger class for TTI request/response logging
 */
export class TTIDebugger {
  private static _enabled: boolean =
    process.env.DEBUG_TTI_REQUESTS === 'true' ||
    process.env.NODE_ENV === 'development';

  private static _logsDir: string =
    process.env.TTI_DEBUG_LOG_DIR ||
    path.join(process.cwd(), 'logs', 'tti', 'requests');

  private static _includeBase64: boolean = false;
  private static _consoleLog: boolean = false;

  // ============================================================
  // CONFIGURATION
  // ============================================================

  /**
   * Check if debugging is enabled
   */
  static get isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Enable or disable debugging
   */
  static setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  /**
   * Get the current logs directory
   */
  static getLogsDir(): string {
    return this._logsDir;
  }

  /**
   * Set the logs directory
   */
  static setLogsDir(dir: string): void {
    this._logsDir = dir;
  }

  /**
   * Configure the debugger
   */
  static configure(config: TTIDebuggerConfig): void {
    if (config.enabled !== undefined) {
      this._enabled = config.enabled;
    }
    if (config.logsDir !== undefined) {
      this._logsDir = config.logsDir;
    }
    if (config.includeBase64 !== undefined) {
      this._includeBase64 = config.includeBase64;
    }
    if (config.consoleLog !== undefined) {
      this._consoleLog = config.consoleLog;
    }
  }

  // ============================================================
  // LOGGING METHODS
  // ============================================================

  /**
   * Log a TTI request (call before generation)
   */
  static async logRequest(debugInfo: TTIDebugInfo): Promise<void> {
    if (!this._enabled) return;

    if (this._consoleLog) {
      console.log('[TTI Debug] Request:', {
        provider: debugInfo.provider,
        model: debugInfo.model,
        useCase: debugInfo.useCase,
        prompt: debugInfo.prompt.substring(0, 100) + '...',
        subjectDescription: debugInfo.subjectDescription,
        referenceImageCount: debugInfo.referenceImageCount,
      });
    }
  }

  /**
   * Log a TTI response (call after generation)
   */
  static async logResponse(debugInfo: TTIDebugInfo): Promise<void> {
    if (!this._enabled) return;

    try {
      await this.saveToMarkdown(debugInfo);

      if (this._consoleLog) {
        console.log('[TTI Debug] Response saved:', {
          provider: debugInfo.provider,
          model: debugInfo.model,
          duration: debugInfo.response?.duration,
          imageCount: debugInfo.response?.imageCount,
        });
      }
    } catch (error) {
      console.error('[TTI Debug] Failed to save log:', error);
    }
  }

  /**
   * Log an error
   */
  static async logError(debugInfo: TTIDebugInfo): Promise<void> {
    if (!this._enabled) return;

    try {
      await this.saveToMarkdown(debugInfo);

      if (this._consoleLog) {
        console.error('[TTI Debug] Error:', debugInfo.error);
      }
    } catch (error) {
      console.error('[TTI Debug] Failed to save error log:', error);
    }
  }

  // ============================================================
  // MARKDOWN GENERATION
  // ============================================================

  /**
   * Save debug info to a markdown file
   */
  static async saveToMarkdown(debugInfo: TTIDebugInfo): Promise<string> {
    this.ensureLogsDirectory();

    const filename = this.generateFilename(debugInfo);
    const filepath = path.join(this._logsDir, filename);
    const content = this.formatMarkdown(debugInfo);

    await fs.promises.writeFile(filepath, content, 'utf-8');

    return filepath;
  }

  /**
   * Generate a filename for the log file
   */
  private static generateFilename(debugInfo: TTIDebugInfo): string {
    const timestamp = debugInfo.requestTimestamp
      .toISOString()
      .replace(/[:.]/g, '-');

    const useCasePart = debugInfo.useCase
      ? `_${debugInfo.useCase.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
      : '';

    const identifierPart = debugInfo.characterId
      ? `_char-${debugInfo.characterId.substring(0, 8)}`
      : debugInfo.sectionId
        ? `_sec-${debugInfo.sectionId.substring(0, 8)}`
        : '';

    return `${timestamp}${useCasePart}${identifierPart}.md`;
  }

  /**
   * Format debug info as markdown
   */
  private static formatMarkdown(debugInfo: TTIDebugInfo): string {
    const sections: string[] = [];

    // Header
    sections.push('# TTI Request & Response Log\n');

    // Provider Information
    sections.push('## Provider Information\n');
    sections.push(`- **Provider**: ${debugInfo.provider}`);
    sections.push(`- **Model**: ${debugInfo.model}`);
    if (debugInfo.region) {
      sections.push(`- **Region**: ${debugInfo.region}`);
    }
    sections.push('');

    // Request Information
    sections.push('## Request Information\n');
    sections.push(
      `- **Request Timestamp**: ${debugInfo.requestTimestamp.toISOString()}`
    );
    if (debugInfo.responseTimestamp) {
      sections.push(
        `- **Response Timestamp**: ${debugInfo.responseTimestamp.toISOString()}`
      );
    }
    if (debugInfo.useCase) {
      sections.push(`- **Use Case**: ${debugInfo.useCase}`);
    }
    if (debugInfo.sessionId) {
      sections.push(`- **Session ID**: ${debugInfo.sessionId}`);
    }
    if (debugInfo.bookId) {
      sections.push(`- **Book ID**: ${debugInfo.bookId}`);
    }
    if (debugInfo.characterId) {
      sections.push(`- **Character ID**: ${debugInfo.characterId}`);
    }
    if (debugInfo.sectionId) {
      sections.push(`- **Section ID**: ${debugInfo.sectionId}`);
    }
    if (debugInfo.aspectRatio) {
      sections.push(`- **Aspect Ratio**: ${debugInfo.aspectRatio}`);
    }
    sections.push('');

    // Reference Images
    sections.push('## Reference Images\n');
    sections.push(`- **Count**: ${debugInfo.referenceImageCount}`);
    if (
      debugInfo.referenceImageMimeTypes &&
      debugInfo.referenceImageMimeTypes.length > 0
    ) {
      sections.push(
        `- **MIME Types**: ${debugInfo.referenceImageMimeTypes.join(', ')}`
      );
    }
    sections.push('');

    // Subject Description (important for character consistency debugging)
    sections.push('## Subject Description\n');
    if (debugInfo.subjectDescription) {
      sections.push('```');
      sections.push(debugInfo.subjectDescription);
      sections.push('```');
    } else {
      sections.push('*No subject description provided (raw multimodal mode)*');
    }
    sections.push('');

    // Prompt (the most important part for debugging)
    sections.push('## Prompt\n');
    sections.push('```');
    sections.push(debugInfo.prompt);
    sections.push('```');
    sections.push('');

    // Provider Options
    if (
      debugInfo.providerOptions &&
      Object.keys(debugInfo.providerOptions).length > 0
    ) {
      sections.push('## Provider Options\n');
      sections.push('```json');
      sections.push(JSON.stringify(debugInfo.providerOptions, null, 2));
      sections.push('```');
      sections.push('');
    }

    // Response
    if (debugInfo.response) {
      sections.push('## Response\n');
      sections.push(`- **Image Count**: ${debugInfo.response.imageCount}`);
      sections.push(
        `- **MIME Types**: ${debugInfo.response.imageMimeTypes.join(', ')}`
      );
      sections.push(`- **Duration**: ${debugInfo.response.duration}ms`);
      sections.push('');
    }

    // Raw Request Data (without base64)
    if (debugInfo.rawRequest) {
      sections.push('## Raw Request Data\n');
      sections.push('```json');
      const sanitizedRequest = this.sanitizeRequest(debugInfo.rawRequest);
      sections.push(JSON.stringify(sanitizedRequest, null, 2));
      sections.push('```');
      sections.push('');
    }

    // Raw Response Data (without base64)
    if (debugInfo.rawResponse) {
      sections.push('## Raw Response Data\n');
      sections.push('```json');
      const sanitizedResponse = this.sanitizeResponse(debugInfo.rawResponse);
      sections.push(JSON.stringify(sanitizedResponse, null, 2));
      sections.push('```');
      sections.push('');
    }

    // Error
    if (debugInfo.error) {
      sections.push('## Error\n');
      sections.push(`- **Message**: ${debugInfo.error.message}`);
      if (debugInfo.error.code) {
        sections.push(`- **Code**: ${debugInfo.error.code}`);
      }
      if (debugInfo.error.details) {
        sections.push('- **Details**:');
        sections.push('```json');
        sections.push(JSON.stringify(debugInfo.error.details, null, 2));
        sections.push('```');
      }
      sections.push('');
    }

    // Footer
    sections.push('---');
    sections.push(`*Generated on ${new Date().toISOString()}*`);

    return sections.join('\n');
  }

  /**
   * Sanitize request by removing/truncating base64 data
   */
  private static sanitizeRequest(request: TTIRequest): Record<string, unknown> {
    const sanitized: Record<string, unknown> = { ...request };

    if (request.referenceImages && !this._includeBase64) {
      sanitized.referenceImages = request.referenceImages.map((ref, index) => ({
        index,
        mimeType: ref.mimeType || 'unknown',
        base64Length: ref.base64?.length || 0,
        base64Preview: ref.base64 ? `${ref.base64.substring(0, 50)}...` : null,
      }));
    }

    return sanitized;
  }

  /**
   * Sanitize response by removing/truncating base64 data
   */
  private static sanitizeResponse(
    response: TTIResponse
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = { ...response };

    if (response.images && !this._includeBase64) {
      sanitized.images = response.images.map((img, index) => ({
        index,
        contentType: img.contentType || 'unknown',
        hasUrl: !!img.url,
        base64Length: img.base64?.length || 0,
        base64Preview: img.base64 ? `${img.base64.substring(0, 50)}...` : null,
      }));
    }

    return sanitized;
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  /**
   * Ensure the logs directory exists
   */
  private static ensureLogsDirectory(): void {
    if (!fs.existsSync(this._logsDir)) {
      fs.mkdirSync(this._logsDir, { recursive: true });
    }
  }

  /**
   * Create debug info from a request (helper for providers)
   */
  static createDebugInfo(
    request: TTIRequest,
    provider: string,
    model: string,
    options?: {
      region?: string;
      useCase?: string;
      sessionId?: string;
      bookId?: string;
      characterId?: string;
      sectionId?: string;
    }
  ): TTIDebugInfo {
    return {
      requestTimestamp: new Date(),
      provider,
      model,
      region: options?.region,
      prompt: request.prompt,
      subjectDescription: request.subjectDescription,
      referenceImageCount: request.referenceImages?.length || 0,
      referenceImageMimeTypes: request.referenceImages?.map(
        (ref) => ref.mimeType || 'unknown'
      ),
      aspectRatio: request.aspectRatio,
      providerOptions: request.providerOptions,
      useCase: options?.useCase,
      sessionId: options?.sessionId,
      bookId: options?.bookId,
      characterId: options?.characterId,
      sectionId: options?.sectionId,
      rawRequest: request,
    };
  }

  /**
   * Update debug info with response data (helper for providers)
   */
  static updateWithResponse(
    debugInfo: TTIDebugInfo,
    response: TTIResponse
  ): TTIDebugInfo {
    return {
      ...debugInfo,
      responseTimestamp: new Date(),
      response: {
        imageCount: response.images.length,
        imageMimeTypes: response.images.map(
          (img) => img.contentType || 'unknown'
        ),
        duration: response.metadata.duration,
      },
      rawResponse: response,
    };
  }

  /**
   * Update debug info with error data (helper for providers)
   */
  static updateWithError(
    debugInfo: TTIDebugInfo,
    error: Error & { code?: string; cause?: unknown }
  ): TTIDebugInfo {
    return {
      ...debugInfo,
      responseTimestamp: new Date(),
      error: {
        message: error.message,
        code: error.code,
        details: error.cause,
      },
    };
  }
}

// ============================================================
// EXPORTS
// ============================================================

export default TTIDebugger;
