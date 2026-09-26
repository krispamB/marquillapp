import { Test, TestingModule } from '@nestjs/testing';
import { EncryptionService } from './encryption.service';
import { ConfigService } from '@nestjs/config';

describe('EncryptionService', () => {
  let service: EncryptionService;
  let configService: jest.Mocked<ConfigService>;

  // A 32-byte hex key for testing (AES-256 requires 32 bytes)
  const TEST_KEY = '12345678901234567890123456789012';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'ENCRYPTION_KEY') {
                return TEST_KEY;
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('encrypt', () => {
    it('should encrypt a string and return it in usage format', async () => {
      const text = 'hello world';
      const result = await service.encrypt(text);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      // format: iv:authTag:encrypted
      const parts = result.split(':');
      expect(parts.length).toBe(3);
    });

    it('should return different outputs for same input (random IV)', async () => {
      const text = 'secure data';
      const result1 = await service.encrypt(text);
      const result2 = await service.encrypt(text);

      expect(result1).not.toBe(result2);
    });
  });

  describe('decrypt', () => {
    it('should decrypt an encrypted string back to original', async () => {
      const original = 'sensitive-info';
      const encrypted = await service.encrypt(original);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it('should throw error if format is invalid', async () => {
      await expect(service.decrypt('invalid-string')).rejects.toThrow();
    });

    it('should fail if auth tag is modified (integrity check)', async () => {
      const original = 'integrity-test';
      const encrypted = await service.encrypt(original);
      const parts = encrypted.split(':');

      // Tamper with the auth tag (middle part)
      // We flip the last char (basic tamper)
      const tamperedTag =
        parts[1].slice(0, -1) + (parts[1].slice(-1) === '0' ? '1' : '0');
      const tamperedString = `${parts[0]}:${tamperedTag}:${parts[2]}`;

      await expect(service.decrypt(tamperedString)).rejects.toThrow();
    });
  });
});
