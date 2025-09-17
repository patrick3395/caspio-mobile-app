import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';

const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then( m => m.LoginPage)
  },
  {
    path: '',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then( m => m.HomePageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'project/:id',
    loadChildren: () => import('./pages/project-detail/project-detail.module').then( m => m.ProjectDetailPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'template-form/:projectId/:offersId',
    loadChildren: () => import('./pages/template-form/template-form.module').then( m => m.TemplateFormPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'new-project',
    loadComponent: () => import('./pages/new-project/new-project.page').then( m => m.NewProjectPage),
    canActivate: [AuthGuard]
  },
  {
    path: 'engineers-foundation/:projectId/:serviceId',
    loadComponent: () => import('./pages/engineers-foundation/engineers-foundation.page').then( m => m.EngineersFoundationPage),
    canActivate: [AuthGuard]
  },
  {
    path: 'hud-template/:projectId/:serviceId',
    loadComponent: () => import('./pages/hud-template/hud-template.page').then( m => m.HudTemplatePage),
    canActivate: [AuthGuard]
  }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
