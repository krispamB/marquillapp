import { readFile, writeFile } from 'node:fs/promises';
import {
  analyzeCreditEconomics,
  renderCreditEconomicsReport,
} from './credit-economics-review';

const run = async (): Promise<void> => {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error(
      'Usage: npm run review:credit-economics -- <input.json> <output.md>',
    );
  }

  const input: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
  const review = analyzeCreditEconomics(input);
  await writeFile(outputPath, renderCreditEconomicsReport(review), 'utf8');
  console.log(`Production credit economics review written to ${outputPath}`);
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Production credit economics review failed: ${message}`);
  process.exitCode = 1;
});
