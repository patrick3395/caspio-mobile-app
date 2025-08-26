import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { AlertController, LoadingController } from '@ionic/angular';
import { CaspioService } from '../../services/caspio.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class LoginPage implements OnInit {
  credentials = {
    email: '',
    password: '',
    companyId: 1
  };

  showPassword = false;
  rememberMe = false;

  constructor(
    private router: Router,
    private caspioService: CaspioService,
    private alertController: AlertController,
    private loadingController: LoadingController
  ) { }

  ngOnInit() {
    // Check if user is already logged in
    const token = localStorage.getItem('authToken');
    const user = localStorage.getItem('currentUser');
    
    if (token && user) {
      // User is already logged in, redirect to active projects
      this.router.navigate(['/tabs/active-projects']);
      return;
    }
    
    // Check for saved credentials
    const savedCredentials = localStorage.getItem('savedCredentials');
    if (savedCredentials) {
      try {
        const creds = JSON.parse(savedCredentials);
        this.credentials.email = creds.email || '';
        this.credentials.companyId = creds.companyId || 1;
        this.rememberMe = true;
      } catch (e) {
        console.error('Error loading saved credentials:', e);
      }
    }
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  async login() {
    if (!this.credentials.email || !this.credentials.password) {
      await this.showAlert('Error', 'Please enter both email and password');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Logging in...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Authenticate user against Users table
      const users = await this.caspioService.authenticateUser(
        this.credentials.email,
        this.credentials.password,
        this.credentials.companyId
      ).toPromise();

      if (users && users.length > 0) {
        const user = users[0];
        
        // Show debug popup with user data
        const debugAlert = await this.alertController.create({
          header: '🔍 Login Debug Info',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: blue;">User Data from Caspio:</strong><br><br>
              
              <strong>User Fields:</strong><br>
              • ID: ${user.PK_ID || user.UserID || 'Not found'}<br>
              • Name: ${user.Name || 'Not found'}<br>
              • Email: ${user.Email || 'Not found'}<br>
              • CompanyID from DB: <strong style="color: red;">${user.CompanyID}</strong><br>
              • Company_ID: ${user.Company_ID || 'Not found'}<br><br>
              
              <strong>Login Request:</strong><br>
              • Requested CompanyID: ${this.credentials.companyId}<br>
              • Email: ${this.credentials.email}<br><br>
              
              <strong>All User Fields:</strong><br>
              <div style="background: #f0f0f0; padding: 5px; border-radius: 3px; max-height: 150px; overflow-y: auto;">
                ${JSON.stringify(user, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong style="color: orange;">What will be stored:</strong><br>
              • CompanyID: ${user.CompanyID}<br>
              
              <p style="color: red; font-weight: bold;">
                If CompanyID is wrong, check Users table!
              </p>
            </div>
          `,
          buttons: [
            {
              text: 'Cancel Login',
              role: 'cancel',
              handler: () => {
                loading.dismiss();
                return true;
              }
            },
            {
              text: 'Use CompanyID 1',
              handler: () => {
                // Force CompanyID to 1 for Noble Property Inspections
                user.CompanyID = 1;
                this.completeLogin(user, loading);
                return true;
              }
            },
            {
              text: 'Continue as is',
              handler: () => {
                this.completeLogin(user, loading);
                return true;
              }
            }
          ]
        });
        await debugAlert.present();
      } else {
        await loading.dismiss();
        await this.showAlert('Login Failed', 'Invalid email or password');
      }
    } catch (error) {
      await loading.dismiss();
      console.error('Login error:', error);
      await this.showAlert('Error', 'An error occurred during login. Please try again.');
    }
  }

  async completeLogin(user: any, loading: any) {
    // Store user info and auth status
    localStorage.setItem('currentUser', JSON.stringify({
      id: user.PK_ID || user.UserID,
      name: user.Name,
      email: user.Email,
      companyId: user.CompanyID
    }));
    
    // Store auth token (use Caspio token if available)
    const token = await this.caspioService.getAuthToken();
    if (token) {
      localStorage.setItem('authToken', token);
    } else {
      // Fallback: create a simple auth indicator
      localStorage.setItem('authToken', 'authenticated');
    }
    
    // Save credentials if remember me is checked
    if (this.rememberMe) {
      localStorage.setItem('savedCredentials', JSON.stringify({
        email: this.credentials.email,
        companyId: this.credentials.companyId
      }));
    } else {
      localStorage.removeItem('savedCredentials');
    }
    
    await loading.dismiss();
    
    // Navigate to main app
    this.router.navigate(['/tabs/active-projects']);
  }

  async showAlert(header: string, message: string) {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  async forgotPassword() {
    const alert = await this.alertController.create({
      header: 'Reset Password',
      message: 'Please contact your administrator to reset your password.',
      buttons: ['OK']
    });
    await alert.present();
  }
}