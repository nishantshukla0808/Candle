import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DuelBankQuestionType, DuelBankSkill, DuelBankStatus } from '@prisma/client';
import { CHART_SERIES_LENGTH, CHART_TEMPLATES, DUEL_BANK_TOPICS } from '@candle/shared';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Question Bank DTOs — docs/05 §2 (Duels Step 1).
 *
 * Boundary validation only: types, shapes, ranges, and the topic
 * allowlist. Workflow rules (transitions, two-person review, option
 * shapes per type, coverage) are DOMAIN rules checked by the service,
 * never validation errors (blueprint §8).
 *
 * Educational disclaimer: all questions are original, educational
 * content only — not investment advice. All companies, tickers, and
 * numbers are fictional illustrations.
 */

export class BankOptionDto {
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

  @ApiProperty({
    required: false,
    default: 0,
    description:
      'CASE_CHOICE only: per-option score fraction — best action 100, second-best 50, other 0. Ignored for other types.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  points?: number;

  @ApiProperty({
    required: false,
    description:
      'CASE_CHOICE only: the one-line consequence shown under the action card. Required for CASE_CHOICE.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  consequence?: string;
}

/** CHART_CHOICE only: the reveal-only annotation (trend + highlighted zone). */
export class ChartAnnotationDto {
  @ApiProperty({
    description: 'Trend direction the reveal highlights.',
    enum: ['rising', 'falling', 'flat', 'volatile'],
  })
  @IsString()
  @IsIn(['rising', 'falling', 'flat', 'volatile'])
  trend!: 'rising' | 'falling' | 'flat' | 'volatile';

  @ApiProperty({ description: 'First point of the highlighted zone (0-based).' })
  @IsInt()
  @Min(0)
  @Max(CHART_SERIES_LENGTH - 1)
  zoneStart!: number;

  @ApiProperty({ description: 'Last point of the highlighted zone (0-based).' })
  @IsInt()
  @Min(0)
  @Max(CHART_SERIES_LENGTH - 1)
  zoneEnd!: number;
}

/** CHART_CHOICE only: structured chart data, drawn from data (never an image). */
export class ChartDataDto {
  @ApiProperty({ example: 'Meadow Foods — price over 6 months' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    description: 'Fictional instrument name only — never a real company or ticker.',
    example: 'Meadow Foods',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  instrument!: string;

  @ApiProperty({
    description: 'Seeded template the series follows (docs/08 §3.4).',
    enum: CHART_TEMPLATES,
  })
  @IsString()
  @IsIn([...CHART_TEMPLATES])
  template!: (typeof CHART_TEMPLATES)[number];

  @ApiProperty({ example: 'Month' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  xLabel!: string;

  @ApiProperty({ example: 'Price (₹)' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  yLabel!: string;

  @ApiProperty({
    description: 'One label per series point.',
    example: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  })
  @IsArray()
  @ArrayMinSize(CHART_SERIES_LENGTH)
  @ArrayMaxSize(CHART_SERIES_LENGTH)
  @IsString({ each: true })
  xLabels!: string[];

  @ApiProperty({
    description: 'The values, one per xLabel — all finite, all positive.',
    example: [100, 104, 109, 113, 118, 124],
  })
  @IsArray()
  @ArrayMinSize(CHART_SERIES_LENGTH)
  @ArrayMaxSize(CHART_SERIES_LENGTH)
  @IsInt({ each: true })
  series!: number[];

  @ApiProperty({
    required: false,
    description:
      'Reveal-only annotation (trend + highlighted zone). Stored with the item; ' +
      'the public view never carries it before reveal.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChartAnnotationDto)
  annotation?: ChartAnnotationDto;
}

/** POST /question-bank/items — ADMIN: create a DRAFT bank item. */
export class CreateBankItemDto {
  @ApiProperty({
    required: false,
    description: 'Stable seed key (e.g. "qb-001"). Generated when omitted.',
    example: 'qb-001',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message: 'key must be lowercase letters, digits, and hyphens',
  })
  @MaxLength(80)
  key?: string;

  @ApiProperty({ example: 'budgeting', description: 'Must be one of DUEL_BANK_TOPICS.' })
  @IsString()
  @IsIn([...DUEL_BANK_TOPICS])
  topic!: string;

  @ApiProperty({ enum: DuelBankSkill })
  @IsEnum(DuelBankSkill)
  skill!: DuelBankSkill;

  @ApiProperty({ enum: DuelBankQuestionType })
  @IsEnum(DuelBankQuestionType)
  type!: DuelBankQuestionType;

  @ApiProperty({ description: 'Author-estimated difficulty, 1 (easy) to 5 (hard).' })
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty!: number;

  @ApiProperty({ required: false, default: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  language?: string;

  @ApiProperty({
    required: false,
    description: 'Source lesson id, when the item maps to a lesson.',
  })
  @IsOptional()
  @IsUUID('4')
  sourceLessonId?: string;

  @ApiProperty({ description: 'The question, in simple English.' })
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  stem!: string;

  @ApiProperty({ description: 'Required: 1–3 short simple sentences, shown after answering.' })
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  explanation!: string;

  @ApiProperty({ required: false, description: 'Template id, for generated variants.' })
  @IsOptional()
  @IsUUID('4')
  templateId?: string;

  @ApiProperty({ required: false, description: 'Template parameter values for this variant.' })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    description:
      'CASE_CHOICE only (required there): structured case numbers as labelled key/value pairs, ' +
      'e.g. {"Monthly income": "₹45,000"}. Shown as a small table by the renderer.',
  })
  @IsOptional()
  @IsObject()
  context?: Record<string, string | number>;

  @ApiProperty({
    required: false,
    description:
      'CASE_CHOICE only (required there): why the best action wins and why each other action is ' +
      'weaker, shown line by line on reveal.',
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(4000)
  rubric?: string;

  @ApiProperty({
    required: false,
    type: ChartDataDto,
    description:
      'CHART_CHOICE only (required there): structured chart data — title, fictional instrument, ' +
      'template, axis labels, 6 xLabels and 6 series values, plus the reveal-only annotation. ' +
      'Drawn from data by the renderer, never an image.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChartDataDto)
  chart?: ChartDataDto;

  @ApiProperty({ type: [BankOptionDto] })
  @IsArray()
  @ArrayMinSize(2, { message: 'A question needs at least 2 options.' })
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => BankOptionDto)
  options!: BankOptionDto[];
}

/** POST /question-bank/items/:id/review — ADMIN: approve or reject a REVIEW item. */
export class ReviewBankItemDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsEnum(['APPROVE', 'REJECT'] as const)
  decision!: 'APPROVE' | 'REJECT';
}

/** POST /question-bank/items/:id/new-version — ADMIN: new DRAFT version of an item. */
export class NewBankItemVersionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsIn([...DUEL_BANK_TOPICS])
  topic?: string;

  @ApiProperty({ required: false, enum: DuelBankSkill })
  @IsOptional()
  @IsEnum(DuelBankSkill)
  skill?: DuelBankSkill;

  @ApiProperty({ required: false, enum: DuelBankQuestionType })
  @IsOptional()
  @IsEnum(DuelBankQuestionType)
  type?: DuelBankQuestionType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  stem?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  explanation?: string;

  @ApiProperty({ required: false, description: 'CASE_CHOICE only: structured case numbers.' })
  @IsOptional()
  @IsObject()
  context?: Record<string, string | number>;

  @ApiProperty({ required: false, description: 'CASE_CHOICE only: rubric, shown on reveal.' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(4000)
  rubric?: string;

  @ApiProperty({
    required: false,
    type: ChartDataDto,
    description: 'CHART_CHOICE only: structured chart data (see CreateBankItemDto.chart).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChartDataDto)
  chart?: ChartDataDto;

  @ApiProperty({ required: false, type: [BankOptionDto], description: 'Replaces all options.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => BankOptionDto)
  options?: BankOptionDto[];
}

/** GET /question-bank/items — ADMIN list, filtered + paginated. */
export class ListBankItemsQueryDto extends PaginationDto {
  @ApiProperty({ required: false, enum: DuelBankStatus })
  @IsOptional()
  @IsEnum(DuelBankStatus)
  status?: DuelBankStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsIn([...DUEL_BANK_TOPICS])
  topic?: string;

  @ApiProperty({ required: false, enum: DuelBankSkill })
  @IsOptional()
  @IsEnum(DuelBankSkill)
  skill?: DuelBankSkill;

  @ApiProperty({ required: false, enum: DuelBankQuestionType })
  @IsOptional()
  @IsEnum(DuelBankQuestionType)
  type?: DuelBankQuestionType;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  language?: string;
}

/**
 * POST /question-bank/select — select a duel set for the given users.
 * `difficultyMix` maps difficulty → count and MUST sum to `count`
 * (checked by the service as a domain rule). `userIds` defaults to
 * the caller; at most 2 (the two players of one duel).
 */
export class SelectBlueprintDto {
  @ApiProperty({ description: 'Number of questions in the set.', example: 7 })
  @IsInt()
  @Min(1)
  @Max(20)
  count!: number;

  @ApiProperty({
    description: 'Items per difficulty; must sum to count.',
    example: { 1: 2, 2: 3, 3: 2 },
  })
  @IsObject()
  difficultyMix!: Record<number, number>;

  @ApiProperty({ required: false, description: 'Restrict to these topics.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsIn([...DUEL_BANK_TOPICS], { each: true })
  topics?: string[];

  @ApiProperty({ required: false, description: 'Restrict to these skills.' })
  @IsOptional()
  @IsArray()
  @IsEnum(DuelBankSkill, { each: true })
  skills?: DuelBankSkill[];

  @ApiProperty({ required: false, description: 'Restrict to these question types.' })
  @IsOptional()
  @IsArray()
  @IsEnum(DuelBankQuestionType, { each: true })
  types?: DuelBankQuestionType[];

  @ApiProperty({
    required: false,
    description: 'Players the set must be fresh for. Defaults to the caller.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiProperty({
    required: false,
    description: 'Max items from one topic in the set. Defaults to 2.',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxPerTopic?: number;
}

/** POST /question-bank/templates/:id/generate — ADMIN: generate DRAFT variants. */
export class GenerateTemplateDto {
  @ApiProperty({ description: 'How many variants to generate (1–50).', example: 5 })
  @IsInt()
  @Min(1)
  @Max(50)
  count!: number;

  @ApiProperty({ description: 'Deterministic seed; same seed replays the same variants.' })
  @IsInt()
  @Min(0)
  seed!: number;
}
