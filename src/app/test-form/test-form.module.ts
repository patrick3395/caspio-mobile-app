import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { TestFormPageRoutingModule } from './test-form-routing.module';

import { TestFormPage } from './test-form.page';

@NgModule({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonicModule,
    TestFormPageRoutingModule
  ],
  declarations: [TestFormPage]
})
export class TestFormPageModule {}