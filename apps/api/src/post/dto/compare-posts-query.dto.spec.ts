import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ComparePostsQueryDto } from './compare-posts-query.dto';

describe('ComparePostsQueryDto', () => {
  it('should pass validation when both months use YYYY-MM', async () => {
    const dto = plainToInstance(ComparePostsQueryDto, {
      currentMonth: '2026-07',
      previousMonth: '2026-06',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('should fail validation when either month is malformed', async () => {
    const dto = plainToInstance(ComparePostsQueryDto, {
      currentMonth: '2026-13',
      previousMonth: 'June 2026',
    });

    await expect(validate(dto)).resolves.toHaveLength(2);
  });

  it('should fail validation when either month is missing', async () => {
    const dto = plainToInstance(ComparePostsQueryDto, {
      currentMonth: '2026-07',
    });

    await expect(validate(dto)).resolves.toHaveLength(1);
  });
});
