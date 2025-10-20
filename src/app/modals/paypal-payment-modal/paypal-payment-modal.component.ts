import { Component, Input, OnInit, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { ModalController, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';

// Declare PayPal namespace for TypeScript
declare const paypal: any;

@Component({
  selector: 'app-paypal-payment-modal',
  templateUrl: './paypal-payment-modal.component.html',
  styleUrls: ['./paypal-payment-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class PaypalPaymentModalComponent implements OnInit, AfterViewInit {
  @Input() invoice: any;
  @ViewChild('paypalButtonContainer', { static: false }) paypalButtonContainer!: ElementRef;

  isLoading = false;
  paymentCompleted = false;
  sdkLoading = true; // Track SDK loading state

  constructor(
    private modalController: ModalController,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    console.log('PayPal Payment Modal initialized with invoice:', this.invoice);
  }

  ngAfterViewInit() {
    // Wait for PayPal SDK to load before rendering button
    this.waitForPayPalSDK();
  }

  private waitForPayPalSDK(retries = 0, maxRetries = 20) {
    // Check if PayPal SDK is loaded
    if (typeof paypal !== 'undefined') {
      console.log('PayPal SDK loaded successfully');
      this.sdkLoading = false;
      this.renderPayPalButton();
      return;
    }

    // If max retries reached, show error
    if (retries >= maxRetries) {
      console.error('PayPal SDK failed to load after max retries');
      this.sdkLoading = false;
      this.showError('PayPal SDK failed to load. Please refresh and try again.');
      return;
    }

    // Retry after 250ms
    console.log(`Waiting for PayPal SDK... (attempt ${retries + 1}/${maxRetries})`);
    setTimeout(() => {
      this.waitForPayPalSDK(retries + 1, maxRetries);
    }, 250);
  }

  renderPayPalButton() {
    if (typeof paypal === 'undefined') {
      console.error('PayPal SDK not loaded in renderPayPalButton');
      this.showError('PayPal SDK failed to load. Please refresh and try again.');
      return;
    }

    const amount = this.invoice?.Amount || '0.00';

    paypal.Buttons({
      style: {
        layout: 'vertical',
        color: 'gold',
        shape: 'rect',
        label: 'paypal',
        height: 48
      },

      // Create order
      createOrder: (data: any, actions: any) => {
        return actions.order.create({
          purchase_units: [{
            description: `Invoice #${this.invoice?.InvoiceID || 'N/A'} - ${this.invoice?.Description || 'Payment'}`,
            amount: {
              currency_code: environment.paypal.currency,
              value: amount
            },
            reference_id: `INV-${this.invoice?.InvoiceID || Date.now()}`
          }]
        });
      },

      // On approval
      onApprove: async (data: any, actions: any) => {
        this.isLoading = true;

        try {
          const order = await actions.order.capture();
          console.log('Payment successful:', order);

          this.paymentCompleted = true;
          this.isLoading = false;

          // Show success message
          await this.showSuccess(order);

          // Return payment details to parent
          this.modalController.dismiss({
            success: true,
            paymentData: {
              orderID: order.id,
              payerID: order.payer.payer_id,
              payerEmail: order.payer.email_address,
              payerName: order.payer.name.given_name + ' ' + order.payer.name.surname,
              amount: order.purchase_units[0].amount.value,
              currency: order.purchase_units[0].amount.currency_code,
              status: order.status,
              createTime: order.create_time,
              updateTime: order.update_time,
              invoiceID: this.invoice?.InvoiceID
            }
          });
        } catch (error) {
          console.error('Error capturing order:', error);
          this.isLoading = false;
          this.showError('Payment capture failed. Please contact support.');
        }
      },

      // On cancel
      onCancel: (data: any) => {
        console.log('Payment cancelled:', data);
        this.showCancelled();
      },

      // On error
      onError: (err: any) => {
        console.error('PayPal error:', err);
        this.showError('An error occurred during payment. Please try again.');
      }
    }).render(this.paypalButtonContainer.nativeElement);
  }

  async showSuccess(order: any) {
    const alert = await this.alertController.create({
      header: 'Payment Successful',
      message: `Your payment of $${order.purchase_units[0].amount.value} has been processed successfully.<br><br>Order ID: ${order.id}`,
      buttons: ['OK']
    });
    await alert.present();
  }

  async showCancelled() {
    const alert = await this.alertController.create({
      header: 'Payment Cancelled',
      message: 'You have cancelled the payment process.',
      buttons: ['OK']
    });
    await alert.present();
  }

  async showError(message: string) {
    const alert = await this.alertController.create({
      header: 'Payment Error',
      message: message,
      buttons: ['OK']
    });
    await alert.present();
  }

  async showZelleInfo() {
    const alert = await this.alertController.create({
      header: 'Zelle Information',
      subHeader: 'Pay to',
      cssClass: 'zelle-info-alert',
      message: `We prefer Zelle payments to avoid transaction fees (we choose not to pass these fees on to our partners).

Name: Patrick Bullock
Number: (512) 298-9395`,
      buttons: ['OK']
    });
    await alert.present();
  }

  cancel() {
    this.modalController.dismiss({ success: false });
  }
}
