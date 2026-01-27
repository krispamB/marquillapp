import { IsNotEmpty, IsString } from 'class-validator';

export class UpdatePostDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
