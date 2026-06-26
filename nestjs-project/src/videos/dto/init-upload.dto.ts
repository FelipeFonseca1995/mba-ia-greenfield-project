import { IsString, MinLength, MaxLength } from 'class-validator';

export class InitUploadDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title: string;
}
