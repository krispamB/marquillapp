import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ValidationPipe } from '@nestjs/common';
import { CreateCheckoutDto } from './create-checkout.dto';

describe('CreateCheckoutDto', () => {
  describe('priceId', () => {
    it('should pass validation when priceId is a Paddle price ID', async () => {
      const dto = plainToInstance(CreateCheckoutDto, {
        priceId: 'pri_01gm81eqze2vmmvhpjg13bfeqg',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('should fail validation when priceId is malformed', async () => {
      const dto = plainToInstance(CreateCheckoutDto, { priceId: 'price_123' });

      await expect(validate(dto)).resolves.not.toHaveLength(0);
    });

    it('should reject client identity when extra fields are provided', async () => {
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      await expect(
        pipe.transform(
          {
            priceId: 'pri_01gm81eqze2vmmvhpjg13bfeqg',
            userData: { userId: 'spoofed', name: 'Spoofed User' },
          },
          { type: 'body', metatype: CreateCheckoutDto },
        ),
      ).rejects.toMatchObject({
        response: {
          message: expect.arrayContaining([
            'property userData should not exist',
          ]),
        },
      });
    });
  });
});
