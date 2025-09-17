import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { HudTemplatePageRoutingModule } from './hud-template-routing.module';

import { HudTemplatePage } from './hud-template.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HudTemplatePageRoutingModule
  ],
  declarations: [HudTemplatePage]
})
export class HudTemplatePageModule {}