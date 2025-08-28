import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HelpGuidePage } from './help-guide.page';

@NgModule({
  imports: [
    RouterModule.forChild([
      {
        path: '',
        component: HelpGuidePage
      }
    ])
  ]
})
export class HelpGuidePageModule {}