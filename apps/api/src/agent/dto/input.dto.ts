import { IsNotEmpty, IsString } from 'class-validator';

export class InputDto {
  @IsNotEmpty()
  @IsString()
  input: string;
}
