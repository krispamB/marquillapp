import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class ConnectLinkedinOrganizationsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  organizationIds: string[];
}
