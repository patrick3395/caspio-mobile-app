import { test, expect } from '@playwright/test';

test.describe('App Initialization', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/');

    // Wait for Angular/Ionic to bootstrap
    await page.waitForSelector('ion-app', { state: 'visible' });

    // Verify the app shell is present
    await expect(page.locator('ion-app')).toBeVisible();
  });

  test('should have correct page title', async ({ page }) => {
    await page.goto('/');

    // Update this to match your actual app title
    await expect(page).toHaveTitle(/Partnership|DCP/i);
  });
});

test.describe('Navigation', () => {
  test('should display navigation elements', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load
    await page.waitForSelector('ion-app', { state: 'visible' });

    // Check for common Ionic navigation elements
    // Adjust these selectors based on your actual app structure
    const hasTabBar = await page.locator('ion-tab-bar').count();
    const hasMenu = await page.locator('ion-menu').count();
    const hasHeader = await page.locator('ion-header').count();

    // At least one navigation element should be present
    expect(hasTabBar + hasMenu + hasHeader).toBeGreaterThan(0);
  });
});

test.describe('Responsive Design', () => {
  test('should adapt to mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await page.waitForSelector('ion-app', { state: 'visible' });

    // Ionic should be in mobile mode
    await expect(page.locator('ion-app')).toBeVisible();
  });

  test('should adapt to tablet viewport', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');

    await page.waitForSelector('ion-app', { state: 'visible' });

    await expect(page.locator('ion-app')).toBeVisible();
  });
});
