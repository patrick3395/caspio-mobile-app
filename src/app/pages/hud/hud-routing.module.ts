import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

// Eager load all components for offline support (no lazy loading = no ChunkLoadError offline)
import { HudContainerPage } from './hud-container/hud-container.page';
import { HudMainPage } from './hud-main/hud-main.page';
import { HudProjectDetailsPage } from './hud-project-details/hud-project-details.page';
import { HudCategoryDetailPage } from './hud-category-detail/hud-category-detail.page';
// Use generic visual-detail page (consolidation)
import { GenericVisualDetailPage } from '../template/visual-detail/visual-detail.page';

const routes: Routes = [
  {
    path: '',
    component: HudContainerPage,
    children: [
      {
        path: '',
        component: HudMainPage
      },
      {
        path: 'project-details',
        component: HudProjectDetailsPage
      },
      {
        path: 'category/:category',
        children: [
          { path: '', component: HudCategoryDetailPage },
          { path: 'visual/:templateId', component: GenericVisualDetailPage }
        ]
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class HudRoutingModule { }
