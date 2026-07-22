import { Transform, type TransformFnParams } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class InterpretVoiceCommandDto {
  @ApiProperty({
    description: '语音识别得到的中文文本。',
    example: '倒回五秒',
    minLength: 1,
    maxLength: 200,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '语音文本必须是字符串。' })
  @IsNotEmpty({ message: '语音文本不能为空。' })
  @MaxLength(200, { message: '语音文本不能超过 200 个字符。' })
  transcript!: string;
}
