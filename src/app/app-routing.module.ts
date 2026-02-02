import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { UnsavedChangesGuard } from './guards/unsaved-changes.guard';
import { SelectivePreloadingStrategy } from './routing/selective-preloading-strategy.service';

// Eager load standalone pages for offline support
import { LoginPage } from './pages/login/login.page';
import { NewProjectPage } from './pages/new-project/new-project.page';
import { HudTemplatePage } from './pages/hud-template/hud-template.page';

// Eager load Engineers Foundation components for offline support
import { EngineersFoundationContainerPage } from './pages/engineers-foundation/engineers-foundation-container/engineers-foundation-container.page';
import { EngineersFoundationMainPage } from './pages/engineers-foundation/engineers-foundation-main/engineers-foundation-main.page';
import { StructuralSystemsHubPage } from './pages/engineers-foundation/structural-systems/structural-systems-hub/structural-systems-hub.page';
import { CategoryDetailPage } from './pages/engineers-foundation/structural-systems/category-detail/category-detail.page';
// EFE-specific elevation pages (not generalized - only used by EFE template)
import { ElevationPlotHubPage } from './pages/template/efe-elevation/elevation-plot-hub/elevation-plot-hub.page';
import { RoomElevationPage } from './pages/template/efe-elevation/room-elevation/room-elevation.page';

// Eager load HUD components for offline support
import { HudContainerPage } from './pages/hud/hud-container/hud-container.page';
import { HudMainPage } from './pages/hud/hud-main/hud-main.page';
import { HudCategoryDetailPage } from './pages/hud/hud-category-detail/hud-category-detail.page';

// Eager load LBW components for offline support
import { LbwContainerPage } from './pages/lbw/lbw-container/lbw-container.page';
import { LbwMainPage } from './pages/lbw/lbw-main/lbw-main.page';
import { LbwCategoriesPage } from './pages/lbw/lbw-categories/lbw-categories.page';
import { LbwCategoryDetailPage } from './pages/lbw/lbw-category-detail/lbw-category-detail.page';

// Eager load DTE components for offline support
import { DteContainerPage } from './pages/dte/dte-container/dte-container.page';
import { DteMainPage } from './pages/dte/dte-main/dte-main.page';
import { DteCategoriesPage } from './pages/dte/dte-categories/dte-categories.page';
import { DteCategoryDetailPage } from './pages/dte/dte-category-detail/dte-category-detail.page';

// Generic visual-detail page (consolidation - replaces template-specific pages)
import { GenericVisualDetailPage } from './pages/template/visual-detail/visual-detail.page';

// Generic category-detail page (consolidation - replaces template-specific pages)
import { GenericCategoryDetailPage } from './pages/template/category-detail/category-detail.page';

// Generic project-detail page (consolidation - replaces template-specific pages)
import { GenericProjectDetailPage } from './pages/template/project-detail/project-detail.page';

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
      { path: '', component: EngineersFoundationMainPage },
      { path: 'project-details', component: GenericProjectDetailPage, canDeactivate: [UnsavedChangesGuard] },
      {
        path: 'structural',
        children: [
          { path: '', component: StructuralSystemsHubPage },
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
      { path: '', component: HudMainPage },
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
      { path: '', component: LbwMainPage },
      { path: 'project-details', component: GenericProjectDetailPage, canDeactivate: [UnsavedChangesGuard] },
      { path: 'categories', component: LbwCategoriesPage },
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
      { path: '', component: DteMainPage },
      { path: 'project-details', component: GenericProjectDetailPage, canDeactivate: [UnsavedChangesGuard] },
      { path: 'categories', component: DteCategoriesPage },
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
