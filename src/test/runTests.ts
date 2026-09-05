import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './extension/index');

    // mssql itself is NOT installed here — can't license it in CI — so these
    // tests only assert this extension's own activation/command registration,
    // never real mssql interop (that's covered by the unit/integration tiers
    // against MockConnectionSharingService instead).
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
