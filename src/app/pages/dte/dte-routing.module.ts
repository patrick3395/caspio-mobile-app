import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

// Eager load all components for offline support (no lazy loading = no ChunkLoadError offline)
import { DteContainerPage } from './dte-container/dte-container.page';
import { DteMainPage } from './dte-main/dte-main.page';
import { DteProjectDetailsPage } from './dte-project-details/dte-project-details.page';
import { DteCategoriesPage } from './dte-categories/dte-categories.page';
import { DteCategoryDetailPage } from './dte-category-detail/dte-category-detail.page';

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
        component: DteCategoryDetailPage
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class DteRoutingModule { }

