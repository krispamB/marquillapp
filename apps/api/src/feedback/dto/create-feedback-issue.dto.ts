import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export enum FeedbackIssueType {
  BUG = 'BUG',
  FEATURE_REQUEST = 'FEATURE_REQUEST',
}

export interface DeviceReport {
  browser: string;
  os: string;
  screenResolution: string;
  viewportSize: string;
  language: string;
}

export class DeviceReportDto implements DeviceReport {
  @IsString()
  @IsNotEmpty()
  browser: string;

  @IsString()
  @IsNotEmpty()
  os: string;

  @IsString()
  @IsNotEmpty()
  screenResolution: string;

  @IsString()
  @IsNotEmpty()
  viewportSize: string;

  @IsString()
  @IsNotEmpty()
  language: string;
}

export class CreateFeedbackIssueDto {
  @IsEnum(FeedbackIssueType)
  type: FeedbackIssueType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => DeviceReportDto)
  deviceReport: DeviceReport;
}
