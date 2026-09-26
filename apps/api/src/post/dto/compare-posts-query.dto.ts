import { Matches } from 'class-validator';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ComparePostsQueryDto {
  @Matches(MONTH_PATTERN)
  currentMonth: string;

  @Matches(MONTH_PATTERN)
  previousMonth: string;
}
