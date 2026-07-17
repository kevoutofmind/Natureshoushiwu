import { Transform, type TransformFnParams } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: '用户电子邮箱，会自动去除首尾空格并转换为小写。',
    example: 'dancer@example.com',
    format: 'email',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsNotEmpty({ message: '请输入电子邮箱。' })
  @IsEmail({}, { message: '请输入有效的电子邮箱格式。' })
  @MaxLength(254, { message: '电子邮箱不能超过 254 个字符。' })
  email!: string;

  @ApiProperty({
    description: '必须包含至少 1 个英文字母和 1 个数字，不允许空格。',
    example: 'Dance2026!',
    minLength: 2,
    maxLength: 72,
    format: 'password',
  })
  @IsNotEmpty({ message: '请输入密码。' })
  @MinLength(2, { message: '密码至少需要 1 个字母和 1 个数字。' })
  @MaxLength(72, { message: '密码不能超过 72 个字符。' })
  @Matches(/^[\x21-\x7E]+$/, {
    message: '密码只能包含英文字母、数字和英文符号，不能包含空格。',
  })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: '密码至少需要包含 1 个字母和 1 个数字。',
  })
  password!: string;
}
