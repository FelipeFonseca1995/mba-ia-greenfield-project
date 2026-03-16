import { IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';

export class ResendConfirmationDto {
  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;
}
