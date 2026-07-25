import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SynthesizeLumiVoiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(220)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  voice?: string;
}
