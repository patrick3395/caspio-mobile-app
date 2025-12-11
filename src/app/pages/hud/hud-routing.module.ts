import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./hud-container/hud-container.page').then(m => m.HudContainerPage),
    children: [
      {
        path: '',
        loadComponent: () => import('./hud-main/hud-main.page').then(m => m.HudMainPage)
      },
      {
        path: 'project-details',
        loadComponent: () => import('./hud-project-details/hud-project-details.page').then(m => m.HudProjectDetailsPage)
      },
      {
        path: 'category/:category',
        loadComponent: () => import('./hud-category-detail/hud-category-detail.page').then(m => m.HudCategoryDetailPage)
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class HudRoutingModule { }

