import { IsOptional, IsString, MinLength } from 'class-validator';

export class ReGeneratePlanDto {
  @IsString()
  @MinLength(10)
  reason: string;

  @IsString()
  @IsOptional()
  task_id?: string;

  @IsString()
  @IsOptional()
  feedback?: string;
}
