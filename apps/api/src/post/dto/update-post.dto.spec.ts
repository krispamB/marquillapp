import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePostDto } from './update-post.dto';

describe('UpdatePostDto', () => {
  it('should trim the title when it is valid', async () => {
    const dto = plainToInstance(UpdatePostDto, {
      title: '  A concise title  ',
    });

    const errors = await validate(dto);

    expect(dto.title).toBe('A concise title');
    expect(errors.find((error) => error.property === 'title')).toBeUndefined();
  });

  it.each([null, '   ', 'x'.repeat(101)])(
    'should reject the title when it is null, blank, or oversized',
    async (title) => {
      const errors = await validate(
        plainToInstance(UpdatePostDto, { title }),
      );

      expect(errors.find((error) => error.property === 'title')).toBeDefined();
    },
  );

  it.each(['artifactId', 'version'] as const)(
    'should reject %s when it is explicitly null',
    async (field) => {
      const errors = await validate(
        plainToInstance(UpdatePostDto, { [field]: null }),
      );

      expect(errors.find((error) => error.property === field)).toBeDefined();
    },
  );
});
