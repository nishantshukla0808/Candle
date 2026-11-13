import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

function ctxWithRequestId(requestId: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ requestId }) }),
  } as ExecutionContext;
}

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  it('wraps plain data in the success envelope', (done) => {
    const handler = { handle: () => of({ hello: 'world' }) } as CallHandler;
    interceptor.intercept(ctxWithRequestId('req_1'), handler).subscribe((out) => {
      expect(out).toEqual({
        success: true,
        data: { hello: 'world' },
        requestId: 'req_1',
        timestamp: expect.any(String),
      });
      done();
    });
  });

  it('passes through an already-enveloped value untouched', (done) => {
    const enveloped = { success: true, data: 1, requestId: 'req_x', timestamp: 't' };
    const handler = { handle: () => of(enveloped) } as CallHandler;
    interceptor.intercept(ctxWithRequestId('req_1'), handler).subscribe((out) => {
      expect(out).toBe(enveloped);
      done();
    });
  });

  it('uses "unknown" when the request has no requestId', (done) => {
    const handler = { handle: () => of('x') } as CallHandler;
    const ctx = { switchToHttp: () => ({ getRequest: () => ({}) }) } as ExecutionContext;
    interceptor.intercept(ctx, handler).subscribe((out) => {
      expect((out as { requestId: string }).requestId).toBe('unknown');
      done();
    });
  });
});
