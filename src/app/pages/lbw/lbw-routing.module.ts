import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

// Eager load all components for offline support (no lazy loading = no ChunkLoadError offline)
import { LbwContainerPage } from '../template/containers/lbw-container/lbw-container.page';
import { LbwMainPage } from './lbw-main/lbw-main.page';
import { LbwProjectDetailsPage } from './lbw-project-details/lbw-project-details.page';
import { LbwCategoriesPage } from './lbw-categories/lbw-categories.page';
// Use generic category-detail page (Dexie-first consolidation)
import { GenericCategoryDetailPage } from '../template/category-detail/category-detail.page';
// Use generic visual-detail page (consolidation)
import { GenericVisualDetailPage } from '../template/visual-detail/visual-detail.page';

const routes: Routes = [
  {
    path: '',
    component: LbwContainerPage,
    children: [
      {
        path: '',
        component: LbwMainPage
      },
      {
        path: 'project-details',
        component: LbwProjectDetailsPage
      },
      {
        path: 'categories',
        component: LbwCategoriesPage
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
export class LbwRoutingModule { }

