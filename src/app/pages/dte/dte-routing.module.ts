import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

// Eager load all components for offline support (no lazy loading = no ChunkLoadError offline)
import { DteContainerPage } from '../template/containers/dte-container/dte-container.page';
import { DteMainPage } from './dte-main/dte-main.page';
import { DteProjectDetailsPage } from './dte-project-details/dte-project-details.page';
import { DteCategoriesPage } from './dte-categories/dte-categories.page';
// Use generic category-detail page (Dexie-first consolidation)
import { GenericCategoryDetailPage } from '../template/category-detail/category-detail.page';
// Use generic visual-detail page (consolidation)
import { GenericVisualDetailPage } from '../template/visual-detail/visual-detail.page';

const routes: Routes = [
  {
    path: '',
    component: DteContainerPage,
    children: [
      {
        path: '',
        component: DteMainPage
      },
      {
        path: 'project-details',
        component: DteProjectDetailsPage
      },
      {
        path: 'categories',
        component: DteCategoriesPage
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
export class DteRoutingModule { }

