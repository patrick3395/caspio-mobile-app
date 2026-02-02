/**
 * Template Services Barrel Export
 *
 * Central export for all template-related services and configuration.
 *
 * Usage:
 * ```typescript
 * import {
 *   TemplateConfig,
 *   TemplateConfigService,
 *   HUD_CONFIG,
 *   EFE_CONFIG,
 *   LBW_CONFIG,
 *   DTE_CONFIG
 * } from '@services/template';
 * ```
 */

// Interfaces
export * from './template-config.interface';

// Configs
export * from './configs';

// Services
export { TemplateConfigService } from './template-config.service';
export { TemplateDataAdapter } from './template-data-adapter.service';
