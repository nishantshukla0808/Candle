import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { of } from 'rxjs';
import { ErrorCode } from '@candle/shared';
import { StrictValidationInterceptor } from './strict-validation.interceptor';
import { STRICT_DTO_KEY } from '../decorators/route.decorators';
import { AppError } from '../errors/app-error';

class SampleDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/** Builds a fake ExecutionContext; attaches metadata the way @Strict(Dto) does. */
function makeContext(
  body: unknown,
  dto: (new (...args: never[]) => object) | undefined
): ExecutionContext {
  const handler = (): void => undefined;
  if (dto) {
    Reflect.defineMetadata(STRICT_DTO_KEY, dto, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  } as unknown as ExecutionContext;
}

describe('StrictValidationInterceptor', () => {
  const interceptor = new StrictValidationInterceptor(new Reflector());
  const handler = { handle: () => of('ok') } as CallHandler;

  function run(
    body: unknown,
    dto: (new (...args: never[]) => object) | undefined
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      try {
        interceptor.intercept(makeContext(body, dto), handler).subscribe({
          next: resolve,
          error: reject,
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Unexpected rejection'));
      }
    });
  }

  it('passes through when the route is not marked @Strict', async () => {
    await expect(run({ email: 'a@b.c', injected: 1 }, undefined)).resolves.toBe('ok');
  });

  it('passes when the body only has known properties', async () => {
    await expect(run({ email: 'a@b.c', note: 'hi' }, SampleDto)).resolves.toBe('ok');
  });

  it('rejects unknown properties with VALIDATION_FAILED', async () => {
    const err: unknown = await run({ email: 'a@b.c', injected: 1 }, SampleDto).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(AppError);
    const appErr = err as AppError;
    expect(appErr.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(appErr.status).toBe(400);
    expect(appErr.details).toEqual([
      { field: 'injected', issue: 'Unknown property is not allowed.' },
    ]);
  });

  it('ignores non-object bodies', async () => {
    await expect(run('a string', SampleDto)).resolves.toBe('ok');
    await expect(run(undefined, SampleDto)).resolves.toBe('ok');
  });
});
