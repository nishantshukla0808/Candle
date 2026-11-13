import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** One answer in a quiz submission. */
export class QuizAnswerDto {
  @ApiProperty({ description: 'Question id.' })
  @IsUUID('4')
  questionId!: string;

  @ApiProperty({ description: 'Selected option ids (empty = skipped).', type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  selectedOptionIds!: string[];
}

/** POST /quiz/attempts/:id/submit — strict: unknown properties rejected. */
export class SubmitQuizDto {
  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one answer is required.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}
