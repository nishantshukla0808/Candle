import { IsUUID } from 'class-validator';

/**
 * Shared path-param DTO — every `:id` param is a UUID, validated at the
 * boundary (blueprint §8). No raw req.params access in services.
 */
export class IdParamDto {
  @IsUUID('4', { message: 'id must be a valid UUID v4' })
  id!: string;
}
