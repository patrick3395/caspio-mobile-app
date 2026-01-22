import { test, expect } from '@playwright/test';
import { mockAuthenticatedUser } from './fixtures/test-fixtures';

test.describe('Project Search', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication to skip login
    await mockAuthenticatedUser(page, {
      email: 'noble+02@noble-pi.com',
      name: 'Test User',
      token: 'mock-token'
    });

    await page.goto('/');
    await page.waitForSelector('ion-app', { state: 'visible' });
  });

  test('should search for a project by address', async ({ page }) => {
    const searchInput = page.locator('[data-testid="project-search"], ion-searchbar input');

    await searchInput.fill('123');

    // Wait for search results
    await page.waitForSelector('[data-testid="search-result"], ion-item', { timeout: 5000 });

    // Results should be visible
    const results = page.locator('[data-testid="search-result"], .search-results ion-item');
    await expect(results.first()).toBeVisible();
  });

  test('should select a project from search results', async ({ page }) => {
    const searchInput = page.locator('[data-testid="project-search"], ion-searchbar input');

    await searchInput.fill('1234 Main');
    await page.waitForTimeout(500); // Wait for search debounce

    // Click first result
    await page.locator('[data-testid="search-result"], .search-results ion-item').first().click();

    // Should navigate to project detail
    await expect(page).toHaveURL(/\/project\//);
  });

  test('should show no results message for invalid search', async ({ page }) => {
    const searchInput = page.locator('[data-testid="project-search"], ion-searchbar input');

    await searchInput.fill('xyznonexistent12345');
    await page.waitForTimeout(1000);

    // Should show no results or empty state
    const noResults = page.locator('[data-testid="no-results"], .no-results, :text("No results")');
    await expect(noResults).toBeVisible();
  });
});
