import { Component, Input, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { ModalController, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { CaspioService } from '../../services/caspio.service';
import { firstValueFrom } from 'rxjs';

// Declare Stripe namespace for TypeScript
declare const Stripe: any;

@Component({
  selector: 'app-stripe-ach-modal',
  templateUrl: './stripe-ach-modal.component.html',
  styleUrls: ['./stripe-ach-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class StripeAchModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() companyId: number | null = null;
  @Input() companyName: string = '';
  @Input() companyEmail: string = '';

  isLoading = false;
  linkCompleted = false;
  sdkLoading = true;
  errorMessage: string | null = null;

  // Bank account details after linking
  bankName: string = '';
  bankLast4: string = '';

  private stripe: any;
  private stripeCustomerId: string | null = null;

  constructor(
    private modalController: ModalController,
    private alertController: AlertController,
    private caspioService: CaspioService
  ) {}

  ngOnInit() {
    console.log('Stripe ACH Modal initialized', { companyId: this.companyId, companyName: this.companyName });
  }

  ngAfterViewInit() {
    this.initializeStripe();
  }

  ngOnDestroy() {
    // Cleanup if needed
  }

  private async initializeStripe() {
    // Wait for Stripe SDK to load
    await this.waitForStripeSDK();

    if (!environment.stripe?.publishableKey) {
      console.error('Stripe publishable key not configured');
      this.sdkLoading = false;
      this.errorMessage = 'Payment configuration error. Please contact support.';
      return;
    }

    try {
      this.stripe = Stripe(environment.stripe.publishableKey);
      console.log('Stripe SDK initialized');
      this.sdkLoading = false;
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
      this.sdkLoading = false;
      this.errorMessage = 'Failed to initialize payment system. Please refresh and try again.';
    }
  }

  private waitForStripeSDK(): Promise<void> {
    return new Promise((resolve) => {
      const maxRetries = 20;
      let retries = 0;

      const checkStripe = () => {
        if (typeof Stripe !== 'undefined') {
          console.log('Stripe SDK loaded');
          resolve();
          return;
        }

        if (retries >= maxRetries) {
          console.error('Stripe SDK failed to load');
          this.sdkLoading = false;
          this.errorMessage = 'Payment system failed to load. Please refresh and try again.';
          resolve();
          return;
        }

        retries++;
        setTimeout(checkStripe, 250);
      };

      checkStripe();
    });
  }

  async linkBankAccount() {
    if (!this.companyId || !this.companyName) {
      this.showError('Company information missing');
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    try {
      // Step 1: Create or get Stripe customer
      console.log('Creating/getting Stripe customer...');
      const customerResult = await firstValueFrom(
        this.caspioService.createStripeCustomer(this.companyId, this.companyName, this.companyEmail)
      );
      this.stripeCustomerId = customerResult.customerId;
      console.log('Stripe customer ID:', this.stripeCustomerId);

      // Step 2: Create Financial Connections session
      console.log('Creating Financial Connections session...');
      const fcSession = await firstValueFrom(
        this.caspioService.createFCSession(this.stripeCustomerId)
      );
      console.log('FC Session created:', fcSession.sessionId);

      // Step 3: Launch Financial Connections modal
      console.log('Launching Financial Connections...');
      const result = await this.stripe.collectFinancialConnectionsAccounts({
        clientSecret: fcSession.clientSecret
      });

      console.log('Financial Connections result:', result);

      if (result.error) {
        throw new Error(result.error.message || 'Bank linking failed');
      }

      if (!result.financialConnectionsSession?.accounts?.length) {
        throw new Error('No bank account was linked');
      }

      // Step 4: Create payment method from linked account
      const linkedAccount = result.financialConnectionsSession.accounts[0];
      console.log('Linked account:', linkedAccount.id);

      const paymentMethodResult = await firstValueFrom(
        this.caspioService.linkStripeBank(this.stripeCustomerId, linkedAccount.id)
      );
      console.log('Payment method created:', paymentMethodResult);

      // Step 5: Save to company record in Caspio
      await firstValueFrom(
        this.caspioService.put(
          `/tables/LPS_Companies/records?q.where=CompanyID=${this.companyId}`,
          {
            AutopayMethod: 'Stripe',
            StripeCustomerID: this.stripeCustomerId,
            StripePaymentMethodID: paymentMethodResult.paymentMethodId,
            StripeBankLast4: paymentMethodResult.last4,
            StripeBankName: paymentMethodResult.bankName,
            AutopayEnabled: true
          }
        )
      );
      console.log('Company record updated with Stripe payment method');

      // Store for display
      this.bankName = paymentMethodResult.bankName;
      this.bankLast4 = paymentMethodResult.last4;
      this.linkCompleted = true;
      this.isLoading = false;

      // Show success
      await this.showSuccess();

      // Return to parent with success data
      this.modalController.dismiss({
        success: true,
        paymentData: {
          customerId: this.stripeCustomerId,
          paymentMethodId: paymentMethodResult.paymentMethodId,
          bankName: paymentMethodResult.bankName,
          last4: paymentMethodResult.last4
        }
      });

    } catch (error: any) {
      console.error('Bank linking error:', error);
      this.isLoading = false;

      // Handle user cancellation
      if (error.message?.includes('cancel') || error.code === 'user_abort') {
        this.showCancelled();
        return;
      }

      this.errorMessage = error.message || 'Failed to link bank account. Please try again.';
      this.showError(this.errorMessage!);
    }
  }

  async showSuccess() {
    const alert = await this.alertController.create({
      header: 'Bank Account Linked',
      message: `Your ${this.bankName} account ending in ${this.bankLast4} has been saved for autopay. Future invoices will be automatically charged to this account.`,
      cssClass: 'custom-document-alert',
      buttons: ['OK']
    });
    await alert.present();
  }

  async showCancelled() {
    const alert = await this.alertController.create({
      header: 'Linking Cancelled',
      message: 'You cancelled the bank account linking process.',
      cssClass: 'custom-document-alert',
      buttons: ['OK']
    });
    await alert.present();
  }

  async showError(message: string) {
    const alert = await this.alertController.create({
      header: 'Error',
      message: message,
      cssClass: 'custom-document-alert',
      buttons: ['OK']
    });
    await alert.present();
  }

  cancel() {
    this.modalController.dismiss({ success: false });
  }
}
