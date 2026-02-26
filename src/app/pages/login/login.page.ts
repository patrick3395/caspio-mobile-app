import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { AlertController, LoadingController } from '@ionic/angular';
import { CaspioService } from '../../services/caspio.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { PlatformDetectionService } from '../../services/platform-detection.service';
import { FormValidationService, FieldValidationState, ValidationRules } from '../../services/form-validation.service';
import { FormKeyboardService } from '../../services/form-keyboard.service';
import { PageTitleService } from '../../services/page-title.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class LoginPage implements OnInit, OnDestroy {
  credentials = {
    email: '',
    password: '',
    companyId: 1
  };

  showPassword = false;
  rememberMe = false;

  // Form validation state (web only)
  isWeb = environment.isWeb;
  validationState: Record<string, FieldValidationState> = {};
  validationRules: Record<string, ValidationRules> = {
    email: { required: true, email: true },
    password: { required: true, minLength: 1 }
  };

  // Dynamic year for copyright
  currentYear = new Date().getFullYear();

  constructor(
    private router: Router,
    private caspioService: CaspioService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    public platform: PlatformDetectionService,
    private formValidation: FormValidationService,
    private formKeyboard: FormKeyboardService,
    private pageTitleService: PageTitleService,
    private pushService: PushNotificationService
  ) { }

  ngOnInit() {
    // G2-SEO-001: Set page title for login
    this.pageTitleService.setTitle('Login');

    // Initialize validation state (web only)
    if (this.isWeb) {
      this.validationState = this.formValidation.createFormState(['email', 'password']);

      // Initialize keyboard navigation (web only) - G2-FORMS-003
      this.formKeyboard.addSubmitShortcut(
        'login-page',
        () => this.login(),
        () => this.isFormValid()
      );
    }

    // Check if user is already logged in
    const token = localStorage.getItem('authToken');
    const user = localStorage.getItem('currentUser');

    if (token && user) {
      // User is already logged in, redirect to active projects
      this.router.navigate(['/tabs/active-projects']);
      return;
    }

    // Restore saved email if remember me was checked
    const savedCredentials = localStorage.getItem('savedCredentials');
    if (savedCredentials) {
      try {
        const saved = JSON.parse(savedCredentials);
        this.credentials.email = saved.email || '';
        this.credentials.companyId = saved.companyId || 1;
        this.rememberMe = true;
      } catch (e) {
        // Silent fail
      }
    }
    // Clean up legacy key
    localStorage.removeItem('savedEmail');
  }

  ngOnDestroy() {
    // Clean up keyboard navigation (web only)
    if (this.isWeb) {
      this.formKeyboard.destroyKeyboardNavigation('login-page');
    }
  }

  // Real-time validation methods (web only)
  onFieldBlur(field: string): void {
    if (!this.isWeb) return;
    this.formValidation.markTouched(this.validationState, field);
    this.validateField(field);
  }

  onFieldInput(field: string): void {
    if (!this.isWeb) return;
    this.formValidation.markDirty(this.validationState, field);
    // Validate on input if field has been touched
    if (this.validationState[field]?.touched) {
      this.validateField(field);
    }
  }

  validateField(field: string): void {
    if (!this.isWeb) return;
    const value = field === 'email' ? this.credentials.email : this.credentials.password;
    this.formValidation.updateFieldState(
      this.validationState,
      field,
      value,
      this.validationRules[field]
    );
  }

  shouldShowError(field: string): boolean {
    return this.formValidation.shouldShowError(this.validationState, field);
  }

  getFieldError(field: string): string | null {
    return this.formValidation.getError(this.validationState, field);
  }

  isFormValid(): boolean {
    if (!this.isWeb) {
      return !!this.credentials.email && !!this.credentials.password;
    }
    // Check basic requirements and validation state
    return !!this.credentials.email &&
           !!this.credentials.password &&
           !this.formValidation.hasErrors(this.validationState);
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
      // G2-SEC-002: Only log errors in non-production to prevent sensitive data exposure
      if (!environment.production) {
        console.error('Login error:', error);
      }
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
    
    // Save email if remember me is checked (never store passwords)
    if (this.rememberMe) {
      localStorage.setItem('savedCredentials', JSON.stringify({
        email: this.credentials.email,
        companyId: this.credentials.companyId
      }));
    } else {
      localStorage.removeItem('savedCredentials');
    }
    
    // Only dismiss loading if it exists (it might already be dismissed)
    if (loading) {
      await loading.dismiss();
    }
    
    // Register push notification token with backend
    try {
      const userId = user.PK_ID || user.UserID;
      this.pushService.registerTokenWithBackend(String(userId), user.Email, String(user.CompanyID));
    } catch { /* push registration is non-critical */ }

    // Navigate to main app
    this.router.navigate(['/tabs/active-projects']);
  }

  async showAlert(header: string, message: string) {
    const alert = await this.alertController.create({
      header,
      message,
      cssClass: 'custom-document-alert',
      buttons: [{ text: 'OK', role: 'cancel', cssClass: 'alert-button-confirm' }]
    });
    await alert.present();
  }

  async forgotPassword() {
    const alert = await this.alertController.create({
      header: 'Reset Password',
      message: 'Please contact the Admin team at 832-210-1319 or engineering@noble-pi.com',
      buttons: [{ text: 'OK', role: 'cancel', cssClass: 'alert-button-confirm' }],
      cssClass: 'custom-document-alert'
    });
    await alert.present();
  }
}