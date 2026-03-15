import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GeneratePlanDto {
  @IsString()
  @IsNotEmpty()
  goal: string;

  @IsString()
  @IsOptional()
  more_info?: string;
}
