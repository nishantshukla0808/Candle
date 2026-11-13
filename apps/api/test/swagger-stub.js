/**
 * Jest-only stub for @nestjs/swagger (ESM-only + browser bundle).
 *
 * E2E tests exercise controllers but never main.ts's SwaggerModule
 * setup, so the decorators can be no-ops here. Types still resolve to
 * the real package; only runtime resolution is mapped.
 *
 * IMPORTANT: property decorators MUST return undefined. TypeScript's
 * __decorate treats a truthy return from a property decorator as a
 * property descriptor and calls Object.defineProperty with it, which
 * corrupts the property (non-writable) and breaks class-transformer.
 */
function decoratorFactory() {
  return function decorator(target, key, descriptor) {
    if (arguments.length === 1) return target; // class decorator
    if (descriptor === undefined) return undefined; // property decorator: must be undefined
    return descriptor; // method / accessor decorator
  };
}

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === '__esModule') return true;
      if (prop === 'default') return {};
      return decoratorFactory;
    },
  }
);
