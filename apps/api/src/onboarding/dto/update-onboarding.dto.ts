import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  CreatorLevel,
  DayOfWeek,
  Goal,
  NumberOfClients,
  PostingFrequency,
} from '../../database/schemas';

export class UpdateOnboardingDto {
  @IsInt()
  @Min(2)
  @Max(5)
  step: number;

  // Step 2 — shared
  @IsOptional()
  @IsString()
  name?: string;

  // Step 2 — Creator
  @IsOptional()
  @IsEnum(CreatorLevel)
  creatorLevel?: CreatorLevel;

  // Step 2 — Pro Writer
  @IsOptional()
  @IsString()
  agencyName?: string;

  @IsOptional()
  @IsEnum(NumberOfClients)
  numberOfClients?: NumberOfClients;

  // Step 3 — goals (Creator → goals, Pro Writer → clientGoal)
  @IsOptional()
  @IsArray()
  @IsEnum(Goal, { each: true })
  goals?: Goal[];

  // Step 4
  @IsOptional()
  @IsEnum(PostingFrequency)
  postingFrequency?: PostingFrequency;

  @IsOptional()
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  postingDays?: DayOfWeek[];

  // Step 5
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topics?: string[];
}
