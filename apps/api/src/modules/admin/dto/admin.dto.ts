import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Admin CMS DTOs — blueprint §15/§17. Every admin endpoint is @Strict:
 * unknown properties are REJECTED, not stripped.
 */

export class CreateTrackDto {
  @ApiProperty({ example: 'foundations' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  slug!: string;

  @ApiProperty({ example: 'Money Foundations' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  order?: number;
}

export class UpdateTrackDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  order?: number;
}

export class CreateModuleDto {
  @ApiProperty({ description: 'Parent track id.' })
  @IsUUID('4')
  trackId!: string;

  @ApiProperty({ example: 'Money Basics' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  order?: number;
}

export class UpdateModuleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  order?: number;
}

export class CreateLessonDto {
  @ApiProperty({ description: 'Parent module id.' })
  @IsUUID('4')
  moduleId!: string;

  @ApiProperty({ example: 'What Money Really Is' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  order?: number;
}

/** Edits the lesson's DRAFT version (created from latest published if needed). */
export class UpdateLessonDraftDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title?: string;

  @ApiProperty({ required: false, description: 'Markdown lesson content.' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(100000)
  contentMarkdown?: string;
}

export class QuestionOptionDto {
  @ApiProperty({ example: 'A medium of exchange' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  @ApiProperty({ default: false })
  @IsBoolean()
  isCorrect!: boolean;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  order?: number;
}

export class CreateQuestionDto {
  @ApiProperty()
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  text!: string;

  @ApiProperty({ description: 'Shown to the learner after answering.' })
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  explanation!: string;

  @ApiProperty({ enum: ['SINGLE', 'MULTI'], default: 'SINGLE' })
  @IsEnum(['SINGLE', 'MULTI'] as const)
  kind!: 'SINGLE' | 'MULTI';

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  order?: number;

  @ApiProperty({ required: false, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  points?: number;

  @ApiProperty({ type: [QuestionOptionDto] })
  @IsArray()
  @ArrayMinSize(2, { message: 'A question needs at least 2 options.' })
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options!: QuestionOptionDto[];
}

export class UpdateQuestionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  text?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  explanation?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  order?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  points?: number;

  @ApiProperty({ required: false, type: [QuestionOptionDto], description: 'Replaces all options.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}
