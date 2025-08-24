import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';

import { ProjectDetailPage } from './project-detail.page';
import { ImageViewerComponent } from '../../components/image-viewer/image-viewer.component';
import { SafeUrlPipe } from '../../pipes/safe-url.pipe';

const routes: Routes = [
  {
    path: '',
    component: ProjectDetailPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild(routes)
  ],
  declarations: [ProjectDetailPage, ImageViewerComponent, SafeUrlPipe]
})
export class ProjectDetailPageModule {}