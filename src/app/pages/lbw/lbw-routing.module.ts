import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./lbw-container/lbw-container.page').then(m => m.LbwContainerPage),
    children: [
      {
        path: '',
        loadComponent: () => import('./lbw-main/lbw-main.page').then(m => m.LbwMainPage)
      },
      {
        path: 'project-details',
        loadComponent: () => import('./lbw-project-details/lbw-project-details.page').then(m => m.LbwProjectDetailsPage)
      },
      {
        path: 'category/:category',
        loadComponent: () => import('./lbw-category-detail/lbw-category-detail.page').then(m => m.LbwCategoryDetailPage)
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LbwRoutingModule { }

