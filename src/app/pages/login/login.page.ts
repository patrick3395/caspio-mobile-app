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
        
        await loading.dismiss();
        
        // Navigate to main app
        this.router.navigate(['/tabs/active-projects']);
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