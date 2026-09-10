const TIMED_OUT = Symbol('timed-out');

/**
 * Races `promise` against a timer. Resolves to the TIMED_OUT sentinel if the
 * timer wins — the original promise is NOT cancelled (nothing in the
 * connectionSharing API supports that), it just stops being waited on, so
 * whatever it was doing keeps running server-side to completion regardless.
 * This only bounds how long the caller waits, not the underlying work.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    promise,
    new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), ms)),
  ]);
}

export { TIMED_OUT };
