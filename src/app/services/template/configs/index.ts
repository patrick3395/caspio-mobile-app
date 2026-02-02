/**
 * Template Configuration Barrel Export
 *
 * Import all configs from this file:
 * import { HUD_CONFIG, EFE_CONFIG, LBW_CONFIG, DTE_CONFIG, ALL_CONFIGS } from './configs';
 */

export { HUD_CONFIG } from './hud.config';
export { EFE_CONFIG } from './efe.config';
export { LBW_CONFIG } from './lbw.config';
export { DTE_CONFIG } from './dte.config';

import { HUD_CONFIG } from './hud.config';
import { EFE_CONFIG } from './efe.config';
import { LBW_CONFIG } from './lbw.config';
import { DTE_CONFIG } from './dte.config';
import { TemplateConfig, TemplateType } from '../template-config.interface';

/**
 * Map of all template configurations by ID
 */
export const ALL_CONFIGS: Record<TemplateType, TemplateConfig> = {
  hud: HUD_CONFIG,
  efe: EFE_CONFIG,
  lbw: LBW_CONFIG,
  dte: DTE_CONFIG,
};

/**
 * Get config by template type
 */
export function getConfigById(id: TemplateType): TemplateConfig {
  return ALL_CONFIGS[id];
}

/**
 * Get config by route prefix
 */
export function getConfigByRoute(routePrefix: string): TemplateConfig | undefined {
  return Object.values(ALL_CONFIGS).find(config => config.routePrefix === routePrefix);
}
