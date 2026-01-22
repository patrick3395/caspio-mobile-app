import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('ion-app', { state: 'visible' });
  });

  test('should display login form', async ({ page }) => {
    await expect(page.locator('[data-testid="email-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-button"]')).toBeVisible();
  });

  test('should show validation error for invalid email', async ({ page }) => {
    await page.fill('[data-testid="email-input"] input', 'invalid-email');
    await page.click('[data-testid="password-input"]'); // Trigger blur

    await expect(page.locator('.validation-error')).toBeVisible();
  });

  test('should toggle password visibility', async ({ page }) => {
    const passwordInput = page.locator('[data-testid="password-input"] input');

    // Initially password type
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Click toggle
    await page.click('[data-testid="toggle-password-visibility"]');

    // Now text type
    await expect(passwordInput).toHaveAttribute('type', 'text');
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await page.fill('[data-testid="email-input"] input', 'noble+02@noble-pi.com');
    await page.fill('[data-testid="password-input"] input', process.env.TEST_PASSWORD || 'test-password');

    await page.click('[data-testid="sign-in-button"]');

    // Wait for navigation away from login
    await expect(page).not.toHaveURL(/\/login/);

    // Should land on main app
    await expect(page.locator('ion-tab-bar')).toBeVisible({ timeout: 10000 });
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.fill('[data-testid="email-input"] input', 'wrong@email.com');
    await page.fill('[data-testid="password-input"] input', 'wrongpassword');

    await page.click('[data-testid="sign-in-button"]');

    // Should show error message (adjust selector based on your error display)
    await expect(page.locator('ion-toast, .error-message, ion-alert')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to forgot password', async ({ page }) => {
    await page.click('[data-testid="forgot-password-button"]');

    // Adjust based on your forgot password flow
    await expect(page).toHaveURL(/forgot|reset/);
  });
});
