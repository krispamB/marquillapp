import { createHash } from 'node:crypto';

/** The lowercase hex SHA-256 a Document Version stores for its objects (§6.3). */
export const sha256Hex = (body: string | Uint8Array): string =>
  createHash('sha256').update(body).digest('hex');
