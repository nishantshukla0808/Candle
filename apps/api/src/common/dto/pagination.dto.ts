import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { PAGINATION } from '@candle/shared';

/**
 * Shared pagination query DTO — blueprint §6.
 * `?page=1&limit=20&sort=createdAt:desc`, capped at 100.
 */
export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = PAGINATION.DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION.MAX_LIMIT)
  limit: number = PAGINATION.DEFAULT_LIMIT;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]*:(asc|desc)$/, {
    message: 'sort must look like "createdAt:desc"',
  })
  sort?: string;
}
