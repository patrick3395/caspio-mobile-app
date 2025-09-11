import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: 'active-projects',
        loadChildren: () => import('../pages/active-projects/active-projects.module').then(m => m.ActiveProjectsPageModule)
      },
      {
        path: 'all-projects',
        loadChildren: () => import('../pages/all-projects/all-projects.module').then(m => m.AllProjectsPageModule)
      },
      {
        path: 'help-guide',
        loadChildren: () => import('../pages/help-guide/help-guide.module').then(m => m.HelpGuidePageModule)
      },
      {
        path: 'company',
        loadChildren: () => import('../pages/company/company.module').then(m => m.CompanyPageModule)
      },
      {
        path: 'settings',
        loadChildren: () => import('../home/home.module').then(m => m.HomePageModule)
      },
      {
        path: '',
        redirectTo: '/tabs/active-projects',
        pathMatch: 'full'
      }
    ]
  },
  {
    path: '',
    redirectTo: '/tabs/active-projects',
    pathMatch: 'full'
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
})
export class TabsPageRoutingModule {}