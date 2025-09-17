import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { SelectivePreloadingStrategy } from './routing/selective-preloading-strategy.service';

const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then( m => m.LoginPage),
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
    loadComponent: () => import('./pages/new-project/new-project.page').then( m => m.NewProjectPage),
    canActivate: [AuthGuard],
    data: { preload: false }
  },
  {
    path: 'engineers-foundation/:projectId/:serviceId',
    loadComponent: () => import('./pages/engineers-foundation/engineers-foundation.page').then( m => m.EngineersFoundationPage),
    canActivate: [AuthGuard],
    data: { preload: false }
  },
  {
    path: 'hud-template/:projectId/:serviceId',
    loadComponent: () => import('./pages/hud-template/hud-template.page').then( m => m.HudTemplatePage),
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
