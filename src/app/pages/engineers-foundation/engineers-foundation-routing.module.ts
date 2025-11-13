import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./engineers-foundation-container/engineers-foundation-container.page').then(m => m.EngineersFoundationContainerPage),
    children: [
      {
        path: '',
        loadComponent: () => import('./engineers-foundation-main/engineers-foundation-main.page').then(m => m.EngineersFoundationMainPage)
      },
      {
        path: 'project-details',
        loadComponent: () => import('./project-details/project-details.page').then(m => m.ProjectDetailsPage)
      },
      {
        path: 'structural',
        children: [
          {
            path: '',
            loadComponent: () => import('./structural-systems/structural-systems-hub/structural-systems-hub.page').then(m => m.StructuralSystemsHubPage)
          },
          {
            path: 'category/:category',
            loadComponent: () => import('./structural-systems/category-detail/category-detail.page').then(m => m.CategoryDetailPage)
          }
        ]
      },
      {
        path: 'elevation',
        children: [
          {
            path: '',
            loadComponent: () => import('./elevation-plot-hub/elevation-plot-hub.page').then(m => m.ElevationPlotHubPage)
          },
          {
            path: 'base-station',
            loadComponent: () => import('./room-elevation/room-elevation.page').then(m => m.RoomElevationPage)
          },
          {
            path: 'room/:roomName',
            loadComponent: () => import('./room-elevation/room-elevation.page').then(m => m.RoomElevationPage)
          }
        ]
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class EngineersFoundationRoutingModule { }
