import * as assert from 'assert';
import { TIMED_OUT, withTimeout } from '../../utils/withTimeout';

suite('withTimeout', () => {
  test('resolves to the promise\'s value when it settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('done'), 50);
    assert.strictEqual(result, 'done');
  });

  test('resolves to TIMED_OUT when the promise is still pending once the timeout elapses', async () => {
    const neverResolves = new Promise<string>(() => {});
    const result = await withTimeout(neverResolves, 10);
    assert.strictEqual(result, TIMED_OUT);
  });
});
