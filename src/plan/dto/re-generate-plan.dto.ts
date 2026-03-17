import { IsOptional, IsString } from 'class-validator';

export class ReGeneratePlanDto {
  @IsString()
  @IsOptional()
  feedback?: string;
}
