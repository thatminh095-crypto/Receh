import { chromium, test } from '@playwright/test';
import { runDemoFlow } from '../../../../../shared/demo-recorder';
import path from 'node:path';

test('demo-video', async () => {
  test.setTimeout(600_000);
  await runDemoFlow(
    chromium,
    path.resolve(__dirname, '..', '..', '..', 'demo-storyboard.json'),
    process.env.DEMO_OUT ?? '/tmp/demo-recordings',
  );
});