import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AnswerConfidence, PlacementChoice } from '@prisma/client';

/** One answer in an assessment submission. */
export class AssessmentAnswerDto {
  @ApiProperty({ description: 'Assessment question id.' })
  @IsUUID('4')
  questionId!: string;

  @ApiProperty({ description: 'Selected option ids (empty = skipped).', type: [String] })
  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID('4', { each: true })
  selectedOptionIds!: string[];

  @ApiProperty({
    description: 'Self-reported confidence. SKIPPED means "I do not know".',
    enum: AnswerConfidence,
  })
  @IsEnum(AnswerConfidence)
  confidence!: AnswerConfidence;
}

/** POST /onboarding/assessment/attempts/:id/submit — strict: unknown properties rejected. */
export class SubmitAssessmentDto {
  @ApiProperty({
    type: [AssessmentAnswerDto],
    description: 'Exactly 12 answers, one per question.',
  })
  @IsArray()
  @ArrayMinSize(12, { message: 'All 12 questions must be answered (use Skip when unsure).' })
  @ArrayMaxSize(12, { message: 'All 12 questions must be answered (use Skip when unsure).' })
  @ValidateNested({ each: true })
  @Type(() => AssessmentAnswerDto)
  answers!: AssessmentAnswerDto[];
}

/** POST /onboarding/placement/accept — strict: unknown properties rejected. */
export class AcceptPlacementDto {
  @ApiProperty({
    description:
      'RECOMMENDED starts where the assessment placed you; FROM_BEGINNING starts at lesson 1.',
    enum: PlacementChoice,
  })
  @IsEnum(PlacementChoice)
  choice!: PlacementChoice;
}
