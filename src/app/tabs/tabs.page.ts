import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: false
})
export class TabsPage implements OnInit {
  isCompanyOne = false;

  constructor() {}

  ngOnInit() {
    // Check if user is from Company ID 1
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        this.isCompanyOne = user.companyId === 1;
      } catch (e) {
        console.error('Error parsing user data:', e);
        this.isCompanyOne = false;
      }
    }
  }
}