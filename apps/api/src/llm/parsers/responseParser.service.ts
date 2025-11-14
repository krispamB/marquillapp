// src/llm/parsers/response-parser.service.ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

//TODO: Fix string type response input.
@Injectable()
export class ResponseParserService {
  /**
   * Parse JSON response with Zod schema validation
   */
  parseWithSchema<T>(response: string, schema: z.ZodSchema<T>): T {
    try {
      const cleaned = this.cleanJsonResponse(response);
      const parsed = JSON.parse(cleaned);
      return schema.parse(parsed);
    } catch (error) {
      throw new Error(`Failed to parse response: ${error.message}`);
    }
  }

  /**
   * Parse JSON array response
   */
  parseArray<T = string>(response: string): T[] {
    try {
      const cleaned = this.cleanJsonResponse(response);
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      return parsed as T[];
    } catch (error) {
      throw new Error(`Failed to parse array: ${error.message}`);
    }
  }

  /**
   * Parse JSON object response
   */
  parseObject<T extends Record<string, any>>(response: string): T {
    try {
      const cleaned = this.cleanJsonResponse(response);
      const parsed = JSON.parse(cleaned);

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('Response is not an object');
      }

      return parsed as T;
    } catch (error) {
      throw new Error(`Failed to parse object: ${error.message}`);
    }
  }

  /**
   * Clean JSON response by removing markdown, extra whitespace, etc.
   */
  private cleanJsonResponse(response: string): string {
    return response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/^[^[{]*/, '') // Remove text before JSON starts
      .replace(/[^}\]]*$/, '') // Remove text after JSON ends
      .trim();
  }

  /**
   * Parse plain text (no conversion, just clean)
   */
  parseText(response: string): string {
    return response.trim();
  }
}
