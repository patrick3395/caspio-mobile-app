import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./dte-container/dte-container.page').then(m => m.DteContainerPage),
    children: [
      {
        path: '',
        loadComponent: () => import('./dte-main/dte-main.page').then(m => m.DteMainPage)
      },
      {
        path: 'project-details',
        loadComponent: () => import('./dte-project-details/dte-project-details.page').then(m => m.DteProjectDetailsPage)
      },
      {
        path: 'category/:category',
        loadComponent: () => import('./dte-category-detail/dte-category-detail.page').then(m => m.DteCategoryDetailPage)
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class DteRoutingModule { }

