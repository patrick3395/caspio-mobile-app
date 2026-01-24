import { chromium, devices } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

interface CaptureOptions {
  url: string;
  name?: string;
  fullPage?: boolean;
  device?: 'desktop' | 'mobile' | 'tablet';
  waitForSelector?: string;
  delay?: number;
}

const deviceProfiles = {
  desktop: { viewport: { width: 1280, height: 720 } },
  mobile: devices['iPhone 12'],
  tablet: devices['iPad (gen 7)'],
};

async function captureScreenshot(options: CaptureOptions) {
  const {
    url,
    name = 'screenshot',
    fullPage = true,
    device = 'desktop',
    waitForSelector = 'ion-app',
    delay = 500,
  } = options;

  const browser = await chromium.launch();
  const context = await browser.newContext(deviceProfiles[device]);
  const page = await context.newPage();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${name}-${device}-${timestamp}.png`;
  const screenshotsDir = path.join(__dirname, '..', 'screenshots');

  // Ensure screenshots directory exists
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const filepath = path.join(screenshotsDir, filename);

  try {
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle' });

    if (waitForSelector) {
      console.log(`Waiting for ${waitForSelector}...`);
      await page.waitForSelector(waitForSelector, { state: 'visible', timeout: 30000 });
    }

    // Wait for any animations/loading to complete
    if (delay > 0) {
      await page.waitForTimeout(delay);
    }

    console.log(`Capturing screenshot...`);
    await page.screenshot({ path: filepath, fullPage });

    console.log(`Screenshot saved: ${filepath}`);
    return filepath;
  } catch (error) {
    console.error('Failed to capture screenshot:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

async function captureMultiple(pages: CaptureOptions[]) {
  const results: string[] = [];

  for (const pageConfig of pages) {
    const filepath = await captureScreenshot(pageConfig);
    results.push(filepath);
  }

  return results;
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Default: capture home page on all devices
    console.log('Usage: npx ts-node e2e/capture-screenshot.ts [url] [name] [device]');
    console.log('Devices: desktop, mobile, tablet');
    console.log('\nExample: npx ts-node e2e/capture-screenshot.ts /home home-page mobile');
    console.log('\nCapturing default (home page, all devices)...\n');

    await captureMultiple([
      { url: 'http://localhost:4200', name: 'home', device: 'desktop' },
      { url: 'http://localhost:4200', name: 'home', device: 'mobile' },
    ]);
    return;
  }

  const [urlPath, name = 'screenshot', device = 'desktop'] = args;
  const url = urlPath.startsWith('http') ? urlPath : `http://localhost:4200${urlPath}`;

  await captureScreenshot({
    url,
    name,
    device: device as 'desktop' | 'mobile' | 'tablet',
  });
}

main().catch(console.error);

export { captureScreenshot, captureMultiple, CaptureOptions };
