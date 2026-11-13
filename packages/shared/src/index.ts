/**
 * @candle/shared — shared contracts for Candle.
 *
 * This package contains ONLY:
 *  - error codes (the catalogue, blueprint §7)
 *  - response envelope types (blueprint §7)
 *  - shared constants (pagination, headers, timeouts)
 *
 * It contains NO business logic, NO secrets, NO I/O. Frontend and backend
 * both depend on it so the envelope shape can never drift between them.
 */

export * from './error-codes';
export * from './responses';
export * from './constants';
