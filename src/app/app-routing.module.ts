import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule)
  },
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then( m => m.HomePageModule)
  },
  {
    path: 'project/:id',
    loadChildren: () => import('./pages/project-detail/project-detail.module').then( m => m.ProjectDetailPageModule)
  },
  {
    path: 'template-form/:projectId/:offersId',
    loadChildren: () => import('./pages/template-form/template-form.module').then( m => m.TemplateFormPageModule)
  },
  {
    path: 'new-project',
    loadComponent: () => import('./pages/new-project/new-project.page').then( m => m.NewProjectPage)
  },
  {
    path: 'engineers-foundation/:projectId/:serviceId',
    loadComponent: () => import('./pages/engineers-foundation/engineers-foundation.page').then( m => m.EngineersFoundationPage)
  }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
