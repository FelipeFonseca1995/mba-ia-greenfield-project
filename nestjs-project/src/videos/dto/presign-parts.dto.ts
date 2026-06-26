import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class PresignPartsDto {
  @IsUUID()
  videoId: string;

  @IsString()
  @IsNotEmpty()
  uploadId: string;

  @IsString()
  @IsNotEmpty()
  key: string;

  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}
