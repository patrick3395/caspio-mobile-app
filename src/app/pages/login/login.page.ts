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
      const users = await this.caspioService.authenticateUser(
        this.credentials.email,
        this.credentials.password,
        this.credentials.companyId
      ).toPromise();
      
      if (users && users.length > 0) {
        const user = users[0];
        
        // Complete the login directly without debug popup
        await this.completeLogin(user, loading);
      } else {
        await loading.dismiss();
        await this.showAlert('Login Failed', 'Invalid email or password. Please try again.');
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