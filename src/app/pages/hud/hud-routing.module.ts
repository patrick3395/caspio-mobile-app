import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

// Eager load all components for offline support (no lazy loading = no ChunkLoadError offline)
import { HudContainerPage } from '../template/containers/hud-container/hud-container.page';
import { HudMainPage } from './hud-main/hud-main.page';
import { HudProjectDetailsPage } from './hud-project-details/hud-project-details.page';
// Use generic category-detail page (Dexie-first consolidation)
import { GenericCategoryDetailPage } from '../template/category-detail/category-detail.page';
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
          { path: '', component: GenericCategoryDetailPage },
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
