import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePostDto } from './create-post.dto';

describe('CreatePostDto', () => {
  it('should trim the title when it is valid', async () => {
    const dto = plainToInstance(CreatePostDto, {
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
        plainToInstance(CreatePostDto, { title }),
      );

      expect(errors.find((error) => error.property === 'title')).toBeDefined();
    },
  );
});
