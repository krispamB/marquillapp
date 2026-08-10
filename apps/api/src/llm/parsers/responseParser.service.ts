// src/llm/parsers/response-parser.service.ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const stripNullObjectValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripNullObjectValues);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== null)
      .map(([key, nested]) => [key, stripNullObjectValues(nested)]),
  );
};

//TODO: Fix string type response input.
@Injectable()
export class ResponseParserService {
  /**
   * Parse JSON response with Zod schema validation
   */
  parseWithSchema<T>(
    response: string,
    schema: z.ZodSchema<T>,
    options?: { stripNullObjectValues?: boolean },
  ): T {
    try {
      const cleaned = this.cleanJsonResponse(response);
      const raw = JSON.parse(cleaned) as unknown;
      const parsed = options?.stripNullObjectValues
        ? stripNullObjectValues(raw)
        : raw;
      return schema.parse(parsed);
    } catch (error: unknown) {
      throw new Error(`Failed to parse response: ${describeError(error)}`);
    }
  }

  /**
   * Parse JSON array response
   */
  parseArray<T = string>(response: string): T[] {
    try {
      const cleaned = this.cleanJsonResponse(response);
      const parsed = JSON.parse(cleaned) as unknown;

      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      return parsed as T[];
    } catch (error: unknown) {
      throw new Error(`Failed to parse array: ${describeError(error)}`);
    }
  }

  /**
   * Parse JSON object response
   */
  parseObject<T extends Record<string, any>>(response: string): T {
    try {
      const cleaned = this.cleanJsonResponse(response);
      const parsed = JSON.parse(cleaned) as unknown;

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('Response is not an object');
      }

      return parsed as T;
    } catch (error: unknown) {
      throw new Error(`Failed to parse object: ${describeError(error)}`);
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
