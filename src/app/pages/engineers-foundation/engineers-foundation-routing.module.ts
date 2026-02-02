import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

// Eager load all components for offline support (no lazy loading = no ChunkLoadError offline)
import { EngineersFoundationContainerPage } from './engineers-foundation-container/engineers-foundation-container.page';
import { EngineersFoundationMainPage } from './engineers-foundation-main/engineers-foundation-main.page';
import { ProjectDetailsPage } from './project-details/project-details.page';
import { StructuralSystemsHubPage } from './structural-systems/structural-systems-hub/structural-systems-hub.page';
import { CategoryDetailPage } from './structural-systems/category-detail/category-detail.page';
// Use generic visual-detail page (consolidation)
import { GenericVisualDetailPage } from '../template/visual-detail/visual-detail.page';
import { ElevationPlotHubPage } from './elevation-plot-hub/elevation-plot-hub.page';
import { RoomElevationPage } from './room-elevation/room-elevation.page';

const routes: Routes = [
  {
    path: '',
    component: EngineersFoundationContainerPage,
    children: [
      {
        path: '',
        component: EngineersFoundationMainPage
      },
      {
        path: 'project-details',
        component: ProjectDetailsPage
      },
      {
        path: 'structural',
        children: [
          {
            path: '',
            component: StructuralSystemsHubPage
          },
          {
            path: 'category/:category',
            children: [
              { path: '', component: CategoryDetailPage },
              { path: 'visual/:templateId', component: GenericVisualDetailPage }
            ]
          }
        ]
      },
      {
        path: 'elevation',
        children: [
          {
            path: '',
            component: ElevationPlotHubPage
          },
          {
            path: 'base-station',
            component: RoomElevationPage
          },
          {
            path: 'room/:roomName',
            component: RoomElevationPage
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
