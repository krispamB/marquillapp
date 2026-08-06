import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefineArtifactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  feedback: string;
}
