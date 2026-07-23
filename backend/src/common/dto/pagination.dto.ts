import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 通用分页 DTO
 */
export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 20;
}

export interface PaginatedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginate<T>(
  list: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return {
    list,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
