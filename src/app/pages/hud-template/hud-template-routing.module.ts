import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { HudTemplatePage } from './hud-template.page';

const routes: Routes = [
  {
    path: '',
    component: HudTemplatePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class HudTemplatePageRoutingModule {}