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
        this.credentials.password = creds.password || '';
        this.credentials.companyId = creds.companyId || 1;
        this.rememberMe = true;
        
        // If we have both email and password saved, they can just click login
        if (this.credentials.email && this.credentials.password) {
          // Optionally auto-login after a short delay
          // setTimeout(() => this.login(), 500);
        }
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
      console.log('Login attempt with:', {
        email: this.credentials.email,
        password: '***hidden***',
        companyId: this.credentials.companyId
      });
      
      const users = await this.caspioService.authenticateUser(
        this.credentials.email,
        this.credentials.password,
        this.credentials.companyId
      ).toPromise();

      console.log('Authentication response - users found:', users?.length || 0);
      
      if (users && users.length > 0) {
        const user = users[0];
        console.log('First user in response:', user);
        
        // Dismiss loading screen FIRST to avoid blocking the debug popup
        await loading.dismiss();
        
        // Show debug popup with user data
        const debugAlert = await this.alertController.create({
          header: '🔍 Login Debug Info',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: blue;">Query Sent:</strong><br>
              • Email: "${this.credentials.email}"<br>
              • Password: ***hidden***<br>
              • Query: Email='${this.credentials.email}' AND Password='***'<br><br>
              
              <strong style="color: green;">User Data Received:</strong><br>
              • Users Found: ${users.length}<br>
              • ID: ${user.PK_ID || user.UserID || user.UsersID || 'No ID field found'}<br>
              • Name: ${user.Name || user.UserName || 'No Name field'}<br>
              • Email: ${user.Email || 'No Email field'}<br>
              • CompanyID: <strong style="color: red;">${user.CompanyID}</strong><br><br>
              
              <strong>All Available Fields:</strong><br>
              ${Object.keys(user).map(key => `• ${key}: ${user[key]}`).join('<br>')}<br><br>
              
              <strong>Raw User Object:</strong><br>
              <div style="background: #f0f0f0; padding: 5px; border-radius: 3px; max-height: 150px; overflow-y: auto;">
                ${JSON.stringify(user, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong style="color: orange;">CompanyID Mismatch:</strong><br>
              • Your User has CompanyID: ${user.CompanyID}<br>
              • Form requested CompanyID: ${this.credentials.companyId}<br>
              
              <p style="color: blue; font-weight: bold;">
                Choose how to proceed:
              </p>
            </div>
          `,
          buttons: [
            {
              text: 'Cancel Login',
              role: 'cancel',
              handler: () => {
                // Loading already dismissed
                return true;
              }
            },
            {
              text: 'Use CompanyID 1',
              handler: () => {
                // Force CompanyID to 1 for Noble Property Inspections
                user.CompanyID = 1;
                this.completeLogin(user, null); // Pass null since loading is already dismissed
                return true;
              }
            },
            {
              text: 'Continue as is',
              handler: () => {
                this.completeLogin(user, null); // Pass null since loading is already dismissed
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
        password: this.credentials.password,
        companyId: this.credentials.companyId
      }));
    } else {
      localStorage.removeItem('savedCredentials');
    }
    
    // Only dismiss loading if it exists (it might already be dismissed)
    if (loading) {
      await loading.dismiss();
    }
    
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