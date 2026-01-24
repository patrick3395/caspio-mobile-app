import { test, expect } from '@playwright/test';
import { mockAuthenticatedUser, waitForPageTransition } from './fixtures/test-fixtures';

test.describe('Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedUser(page, {
      email: 'noble+02@noble-pi.com',
      name: 'Test User',
      token: 'mock-token'
    });

    await page.goto('/');
    await page.waitForSelector('ion-app', { state: 'visible' });
  });

  test('should navigate to All Projects tab', async ({ page }) => {
    await page.click('[data-testid="tab-all-projects"], ion-tab-button:has-text("All Projects")');

    await waitForPageTransition(page);

    await expect(page).toHaveURL(/projects|all/i);
  });

  test('should navigate to Help Guide tab', async ({ page }) => {
    await page.click('[data-testid="tab-help-guide"], ion-tab-button[tab="help-guide"]');

    await waitForPageTransition(page);

    await expect(page.locator('[data-testid="help-guide-page"]')).toBeVisible();
  });

  test('should navigate to Company tab', async ({ page }) => {
    await page.click('[data-testid="tab-company"], ion-tab-button:has-text("Company")');

    await waitForPageTransition(page);

    await expect(page).toHaveURL(/company/i);
  });
});

test.describe('Back Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedUser(page, {
      email: 'noble+02@noble-pi.com',
      name: 'Test User',
      token: 'mock-token'
    });
  });

  test('should go back from project detail', async ({ page }) => {
    // Navigate to a project
    await page.goto('/project/123');
    await page.waitForSelector('ion-app', { state: 'visible' });

    // Click back button
    await page.click('[data-testid="back-button"], ion-back-button, ion-button:has-text("Go back")');

    await waitForPageTransition(page);

    // Should be back on projects list
    await expect(page).not.toHaveURL(/\/project\/123/);
  });

  test('should navigate back using breadcrumbs', async ({ page }) => {
    await page.goto('/engineers-foundation/123');
    await page.waitForSelector('ion-app', { state: 'visible' });

    // Click breadcrumb to go back to project
    await page.click('[data-testid="breadcrumb-project"], .breadcrumb-item:has-text("Project")');

    await waitForPageTransition(page);

    await expect(page).toHaveURL(/\/project\//);
  });
});

test.describe('Project List', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedUser(page, {
      email: 'noble+02@noble-pi.com',
      name: 'Test User',
      token: 'mock-token'
    });

    await page.goto('/');
    await page.waitForSelector('ion-app', { state: 'visible' });
  });

  test('should display project cards', async ({ page }) => {
    // Navigate to all projects
    await page.click('ion-tab-button:has-text("All Projects")');
    await page.waitForTimeout(500);

    // Project cards should be visible
    const projectCards = page.locator('[data-testid="project-card"], ion-card, .project-card');
    await expect(projectCards.first()).toBeVisible();
  });

  test('should open project detail when clicking a project', async ({ page }) => {
    await page.click('ion-tab-button:has-text("All Projects")');
    await page.waitForTimeout(500);

    // Click first project
    await page.locator('[data-testid="project-card"], ion-card, .project-card').first().click();

    await waitForPageTransition(page);

    // Should be on project detail page
    await expect(page).toHaveURL(/\/project\//);
  });
});
