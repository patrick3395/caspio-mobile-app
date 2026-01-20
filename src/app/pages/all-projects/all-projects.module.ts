import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { AllProjectsPage } from './all-projects.page';
import { VirtualScrollComponent } from '../../components/virtual-scroll/virtual-scroll.component';

const routes: Routes = [
  {
    path: '',
    component: AllProjectsPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild(routes),
    ScrollingModule,
    VirtualScrollComponent
  ],
  declarations: [AllProjectsPage]
})
export class AllProjectsPageModule {}