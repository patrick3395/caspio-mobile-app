import { test as base, expect } from '@playwright/test';

/**
 * Extended test fixtures for Ionic/Angular E2E testing
 */

// Custom fixture type definitions
type TestFixtures = {
  /** Wait for Ionic app to fully initialize */
  waitForApp: () => Promise<void>;
};

/**
 * Extended test with custom fixtures for Ionic apps
 */
export const test = base.extend<TestFixtures>({
  waitForApp: async ({ page }, use) => {
    const waitForApp = async () => {
      // Wait for Angular to bootstrap
      await page.waitForSelector('ion-app', { state: 'visible' });

      // Wait for any loading spinners to disappear
      await page.waitForFunction(() => {
        const spinners = document.querySelectorAll('ion-loading, ion-spinner');
        return spinners.length === 0;
      }, { timeout: 10000 }).catch(() => {
        // Ignore timeout - some pages may not have spinners
      });

      // Small delay for Ionic animations
      await page.waitForTimeout(300);
    };

    await use(waitForApp);
  },
});

export { expect };

/**
 * Helper to mock authentication state
 * Adjust based on your actual auth implementation (Cognito)
 */
export async function mockAuthenticatedUser(page: import('@playwright/test').Page, user: {
  email: string;
  name: string;
  token?: string;
}) {
  // Example: Set localStorage/sessionStorage values that your app checks
  await page.addInitScript((userData) => {
    // Adjust these keys based on your actual auth storage
    localStorage.setItem('userEmail', userData.email);
    localStorage.setItem('userName', userData.name);
    if (userData.token) {
      localStorage.setItem('accessToken', userData.token);
    }
  }, user);
}

/**
 * Helper to clear authentication state
 */
export async function clearAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

/**
 * Helper to wait for Ionic page transition to complete
 */
export async function waitForPageTransition(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const pages = document.querySelectorAll('ion-page');
    const transitioning = Array.from(pages).some(
      (p) => p.classList.contains('ion-page-invisible') === false
    );
    return transitioning;
  });
  // Wait for animation to complete
  await page.waitForTimeout(400);
}

/**
 * Helper to interact with Ionic action sheets
 */
export async function clickActionSheetButton(page: import('@playwright/test').Page, buttonText: string) {
  await page.waitForSelector('ion-action-sheet', { state: 'visible' });
  await page.locator(`ion-action-sheet button:has-text("${buttonText}")`).click();
  await page.waitForSelector('ion-action-sheet', { state: 'hidden' });
}

/**
 * Helper to interact with Ionic alerts
 */
export async function clickAlertButton(page: import('@playwright/test').Page, buttonText: string) {
  await page.waitForSelector('ion-alert', { state: 'visible' });
  await page.locator(`ion-alert button:has-text("${buttonText}")`).click();
  await page.waitForSelector('ion-alert', { state: 'hidden' });
}

/**
 * Helper to dismiss Ionic toast
 */
export async function waitForToastDismiss(page: import('@playwright/test').Page) {
  await page.waitForSelector('ion-toast', { state: 'hidden', timeout: 10000 }).catch(() => {
    // Toast may have already dismissed
  });
}
