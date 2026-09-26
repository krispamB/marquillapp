import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

@Injectable()
export class EncryptionService {
  private encryptionKey: Buffer;

  constructor(private configService: ConfigService) {}

  private async getKey(): Promise<Buffer> {
    if (this.encryptionKey) return this.encryptionKey;

    const secret = this.configService.get<string>('ENCRYPTION_KEY');
    if (!secret) {
      throw new Error('ENCRYPTION_KEY is not defined in environment variables');
    }

    const key = (await promisify(scrypt)(secret, 'salt', 32)) as Buffer;
    this.encryptionKey = key;
    return key;
  }

  async encrypt(text: string): Promise<string> {
    const key = await this.getKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  async decrypt(text: string): Promise<string> {
    const key = await this.getKey();
    const parts = text.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted text format');
    }
    const [ivHex, authTagHex, encryptedHex] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
