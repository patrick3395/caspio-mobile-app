import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { UnsavedChangesGuard } from './guards/unsaved-changes.guard';
import { SelectivePreloadingStrategy } from './routing/selective-preloading-strategy.service';

// Eager load standalone pages for offline support
import { LoginPage } from './pages/login/login.page';
import { NewProjectPage } from './pages/new-project/new-project.page';
import { HudTemplatePage } from './pages/hud-template/hud-template.page';

// Template container pages (all moved to pages/template/containers/)
import { EngineersFoundationContainerPage } from './pages/template/containers/efe-container/engineers-foundation-container.page';
import { HudContainerPage } from './pages/template/containers/hud-container/hud-container.page';
import { LbwContainerPage } from './pages/template/containers/lbw-container/lbw-container.page';
import { DteContainerPage } from './pages/template/containers/dte-container/dte-container.page';
import { CsaContainerPage } from './pages/template/containers/csa-container/csa-container.page';

// EFE-specific elevation pages (not generalized - only used by EFE template)
import { ElevationPlotHubPage } from './pages/template/efe-elevation/elevation-plot-hub/elevation-plot-hub.page';
import { RoomElevationPage } from './pages/template/efe-elevation/room-elevation/room-elevation.page';

// Generic visual-detail page (consolidation - replaces template-specific pages)
import { GenericVisualDetailPage } from './pages/template/visual-detail/visual-detail.page';

// Generic category-detail page (consolidation - replaces template-specific pages)
import { GenericCategoryDetailPage } from './pages/template/category-detail/category-detail.page';

// Generic project-detail page (consolidation - replaces template-specific pages)
import { GenericProjectDetailPage } from './pages/template/project-detail/project-detail.page';

// Generic main page (consolidation - replaces template-specific main pages)
import { GenericMainPage } from './pages/template/main/main.page';

// Generic category-hub page (consolidation - replaces template-specific category hub pages)
import { GenericCategoryHubPage } from './pages/template/category-hub/category-hub.page';

const routes: Routes = [
  {
    path: 'login',
    component: LoginPage,
    data: { preload: false }
  },
  {
    path: '',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule),
    canActivate: [AuthGuard],
    data: { preload: true }
  },
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then( m => m.HomePageModule),
    canActivate: [AuthGuard],
    data: { preload: true }
  },
  {
    path: 'project/:id',
    loadChildren: () => import('./pages/project-detail/project-detail.module').then( m => m.ProjectDetailPageModule),
    canActivate: [AuthGuard],
    data: { preload: false }
  },
  {
    path: 'template-form/:projectId/:offersId',
    loadChildren: () => import('./pages/template-form/template-form.module').then( m => m.TemplateFormPageModule),
    canActivate: [AuthGuard],
    data: { preload: false }
  },
  {
    path: 'new-project',
    component: NewProjectPage,
    canActivate: [AuthGuard],
    data: { preload: false }
  },
  // Engineers Foundation routes - eager loaded for offline support
  {
    path: 'engineers-foundation/:projectId/:serviceId',
    component: EngineersFoundationContainerPage,
    canActivate: [AuthGuard],
    children: [
      { path: '', component: GenericMainPage },
      { path: 'project-details', component: GenericProjectDetailPage, canDeactivate: [UnsavedChangesGuard] },
      {
        path: 'structural',
        children: [
          { path: '', component: GenericCategoryHubPage },
          {
            path: 'category/:category',
            children: [
              { path: '', component: GenericCategoryDetailPage, canDeactivate: [UnsavedChangesGuard] },
              { path: 'visual/:templateId', component: GenericVisualDetailPage, canDeactivate: [UnsavedChangesGuard] }
            ]
          }
        ]
      },
      {
        path: 'elevation',
        children: [
          { path: '', component: ElevationPlotHubPage },
          { path: 'base-station', component: RoomElevationPage, canDeactivate: [UnsavedChangesGuard] },
          { path: 'room/:roomName', component: RoomElevationPage, canDeactivate: [UnsavedChangesGuard] }
        ]
      }
    ]
  },
  // HUD routes - eager loaded for offline support
  {
    path: 'hud/:projectId/:serviceId',
    component: HudContainerPage,
    canActivate: [AuthGuard],
    children: [
      { path: '', component: GenericMainPage },
      { path: 'project-details', component: GenericProjectDetailPage, canDeactivate: [UnsavedChangesGuard] },
      {
        path: 'category/:category',
        children: [
          { path: '', component: GenericCategoryDetailPage, canDeactivate: [UnsavedChangesGuard] },
          { path: 'visual/:templateId', component: GenericVisualDetailPage, canDeactivate: [UnsavedChangesGuard] }
        ]
      }
    ]
  },
  // LBW routes - eager loaded for offline support
  {
    path: 'lbw/:projectId/:serviceId',
    component: LbwContainerPage,
    canActivate: [AuthGuard],
    children: [
      { path: '', component: GenericMainPage },
      { path: 'project-details', component: GenericProjectDetailPage, canDeactivate: [UnsavedChangesGuard] },
      { path: 'categories', component: GenericCategoryHubPage },
      {
        path: 'category/:category',
        children: [
          { path: '', component: GenericCategoryDetailPage, canDeactivate: [UnsavedChangesGuard] },
          { path: 'visual/:templateId', component: GenericVisualDetailPage, canDeactivate: [UnsavedChangesGuard] }
        ]
      }
    ]
  },
  // DTE routes - eager loaded for offline support
  {
    path: 'dte/:projectId/:serviceId',
    component: DteContainerPage,
    canActivate: [AuthGuard],
    children: [
      { path: '', component: GenericMainPage },
      { path: 'project-details', component: GenericProjectDetailPage, canDeactivate: [UnsavedChangesGuard] },
      { path: 'categories', component: GenericCategoryHubPage },
      {
        path: 'category/:category',
        children: [
          { path: '', component: GenericCategoryDetailPage, canDeactivate: [UnsavedChangesGuard] },
          { path: 'visual/:templateId', component: GenericVisualDetailPage, canDeactivate: [UnsavedChangesGuard] }
        ]
      }
    ]
  },
  // CSA routes - eager loaded for offline support
  {
    path: 'csa/:projectId/:serviceId',
    component: CsaContainerPage,
    canActivate: [AuthGuard],
    children: [
      { path: '', component: GenericMainPage },
      { path: 'project-details', component: GenericProjectDetailPage, canDeactivate: [UnsavedChangesGuard] },
      { path: 'categories', component: GenericCategoryHubPage },
      {
        path: 'category/:category',
        children: [
          { path: '', component: GenericCategoryDetailPage, canDeactivate: [UnsavedChangesGuard] },
          { path: 'visual/:templateId', component: GenericVisualDetailPage, canDeactivate: [UnsavedChangesGuard] }
        ]
      }
    ]
  },
  {
    path: 'hud-template/:projectId/:serviceId',
    component: HudTemplatePage,
    canActivate: [AuthGuard],
    data: { preload: false }
  }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: SelectivePreloadingStrategy })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
