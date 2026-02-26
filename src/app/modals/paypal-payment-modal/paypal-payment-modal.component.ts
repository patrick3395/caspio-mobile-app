import { Component, Input, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { ModalController, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { CaspioService } from '../../services/caspio.service';
import { firstValueFrom } from 'rxjs';

// Declare PayPal namespace for TypeScript
declare const paypal: any;

@Component({
  selector: 'app-paypal-payment-modal',
  templateUrl: './paypal-payment-modal.component.html',
  styleUrls: ['./paypal-payment-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class PaypalPaymentModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() invoice: any;
  @Input() companyId: number | null = null;
  @Input() companyName: string = '';
  @Input() showAutopayOption: boolean = false;
  @Input() saveForAutopayOnly: boolean = false; // Mode to only save payment method without charging
  @ViewChild('paypalButtonContainer', { static: false }) paypalButtonContainer!: ElementRef;

  isLoading = false;
  paymentCompleted = false;
  sdkLoading = true; // Track SDK loading state
  saveForAutopay = false; // Whether to save payment method for autopay
  originalAmount = 0;
  grossAmount = 0;
  paypalFee = 0;
  private overlayFixInterval: any = null;

  constructor(
    private modalController: ModalController,
    private alertController: AlertController,
    private caspioService: CaspioService
  ) {}

  ngOnInit() {
    // If in save-only mode, automatically check the save for autopay checkbox
    if (this.saveForAutopayOnly) {
      this.saveForAutopay = true;
    }

    // Calculate PayPal processing fee gross-up (skip for vault-only mode)
    if (!this.saveForAutopayOnly) {
      const amt = parseFloat(this.invoice?.Amount) || 0;
      this.originalAmount = amt;
      this.grossAmount = Math.ceil((amt + 0.49) / (1 - 0.0349) * 100) / 100;
      this.paypalFee = Math.round((this.grossAmount - amt) * 100) / 100;
    }
  }

  ngAfterViewInit() {
    // Wait for PayPal SDK to load before rendering button
    this.waitForPayPalSDK();
    this.startOverlayFix();
  }

  ngOnDestroy() {
    this.stopOverlayFix();
  }

  /**
   * Poll for PayPal SDK overlays and push them below the safe area.
   * PayPal's zoid creates fixed-position divs with iframes at the body level.
   * We can't predict their exact selectors, so we scan all body children.
   */
  private startOverlayFix() {
    this.overlayFixInterval = setInterval(() => {
      // Scan all direct children of body for fixed-position overlay containers
      const bodyChildren = document.body.children;
      for (let i = 0; i < bodyChildren.length; i++) {
        const el = bodyChildren[i] as HTMLElement;
        if (!el.style) continue;

        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed') continue;

        // Check if this fixed element contains any iframe (PayPal checkout)
        const iframes = el.querySelectorAll('iframe');
        if (iframes.length === 0) continue;

        // Skip Ionic overlays (they handle safe area themselves)
        if (el.tagName.startsWith('ION-')) continue;

        // Apply safe-area offset if not already applied
        if (!el.dataset['safeAreaFixed']) {
          el.style.setProperty('top', 'env(safe-area-inset-top, 0px)', 'important');
          el.style.setProperty('height', 'calc(100% - env(safe-area-inset-top, 0px))', 'important');
          el.dataset['safeAreaFixed'] = '1';
        }
      }
    }, 300);
  }

  private stopOverlayFix() {
    if (this.overlayFixInterval) {
      clearInterval(this.overlayFixInterval);
      this.overlayFixInterval = null;
    }
  }

  private waitForPayPalSDK(retries = 0, maxRetries = 20) {
    // Check if PayPal SDK is loaded
    if (typeof paypal !== 'undefined') {
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

    // Use different flow for save-only mode vs payment mode
    if (this.saveForAutopayOnly) {
      this.renderVaultOnlyButton();
    } else {
      this.renderPaymentButton();
    }
  }

  /**
   * Render PayPal button for save-only mode (no payment, just vault)
   * Uses server-side order creation with vault configuration
   */
  private renderVaultOnlyButton() {

    paypal.Buttons({
      style: {
        layout: 'vertical',
        color: 'gold',
        shape: 'rect',
        label: 'paypal',
        height: 48
      },

      // Create order server-side with vault configuration
      createOrder: async () => {
        try {
          const response = await firstValueFrom(
            this.caspioService.createPayPalOrderWithVault(
              '1.00',
              'Payment Method Verification - LPS Foundations'
            )
          );
          return response.orderId;
        } catch (error) {
          console.error('Failed to create order:', error);
          throw error;
        }
      },

      // On approval - capture via server to get vault token
      onApprove: async (data: any) => {
        this.isLoading = true;

        try {
          // Capture order via server to get vault token
          const captureResult = await firstValueFrom(
            this.caspioService.capturePayPalOrder(data.orderID)
          );

          const vaultToken = captureResult.vaultToken;

          if (!vaultToken) {
            console.error('No vault token in capture response');
            throw new Error('Failed to save payment method - no vault token received');
          }


          // Save the payment method to the company record and enable autopay
          if (this.companyId) {
            await firstValueFrom(
              this.caspioService.put(
                `/tables/LPS_Companies/records?q.where=CompanyID=${this.companyId}`,
                {
                  PayPalVaultToken: vaultToken,
                  PayPalPayerID: captureResult.payerId,
                  PayPalPayerEmail: captureResult.payerEmail,
                  AutopayEnabled: true
                }
              )
            );
          }

          this.paymentCompleted = true;
          this.isLoading = false;

          // Show success message
          await this.showVaultSuccess(captureResult.payerEmail || 'your PayPal account');

          // Return vault details to parent
          this.modalController.dismiss({
            success: true,
            savedPaymentMethod: true,
            paymentData: {
              vaultToken: vaultToken,
              payerID: captureResult.payerId,
              payerEmail: captureResult.payerEmail,
              verificationAmount: '1.00'
            }
          });
        } catch (error) {
          console.error('Error during verification:', error);
          this.isLoading = false;
          this.showError('Failed to save payment method. Please try again.');
        }
      },

      // On cancel
      onCancel: (data: any) => {
        this.showCancelled();
      },

      // On error
      onError: (err: any) => {
        console.error('PayPal verification error:', err);
        this.showError('An error occurred. Please try again.');
      }
    }).render(this.paypalButtonContainer.nativeElement);
  }

  /**
   * Render PayPal button for normal payment mode
   */
  private renderPaymentButton() {
    const amount = this.grossAmount.toFixed(2);

    paypal.Buttons({
      style: {
        layout: 'vertical',
        color: 'gold',
        shape: 'rect',
        label: 'paypal',
        height: 48
      },

      // Create order with optional vault for autopay
      createOrder: (data: any, actions: any) => {
        const orderData: any = {
          intent: 'CAPTURE',
          purchase_units: [{
            description: `Invoice #${this.invoice?.InvoiceID || 'N/A'} - ${this.invoice?.Description || 'Payment'}`,
            amount: {
              currency_code: environment.paypal.currency,
              value: amount
            },
            reference_id: `INV-${this.invoice?.InvoiceID || Date.now()}`
          }]
        };

        // Add vault configuration if saving for autopay
        if (this.saveForAutopay && this.companyId) {
          orderData.payment_source = {
            paypal: {
              attributes: {
                vault: {
                  store_in_vault: 'ON_SUCCESS',
                  usage_type: 'MERCHANT',
                  customer_type: 'CONSUMER'
                }
              },
              experience_context: {
                return_url: window.location.href,
                cancel_url: window.location.href
              }
            }
          };
        }

        return actions.order.create(orderData);
      },

      // On approval
      onApprove: async (data: any, actions: any) => {
        this.isLoading = true;

        try {
          const order = await actions.order.capture();

          // Check if vault token was saved (for autopay)
          let vaultToken: string | null = null;
          if (this.saveForAutopay && this.companyId) {
            // Extract vault token from the payment response
            // PayPal returns vault info in payment_source.paypal.attributes.vault
            const vaultInfo = order?.payment_source?.paypal?.attributes?.vault;
            if (vaultInfo?.id) {
              vaultToken = vaultInfo.id;

              // Save the payment method to the company record
              try {
                await firstValueFrom(
                  this.caspioService.put(
                    `/tables/LPS_Companies/records?q.where=CompanyID=${this.companyId}`,
                    {
                      PayPalVaultToken: vaultToken,
                      PayPalPayerID: order.payer.payer_id,
                      PayPalPayerEmail: order.payer.email_address
                    }
                  )
                );
              } catch (saveError) {
                console.error('Failed to save payment method:', saveError);
                // Don't fail the payment, just log the error
              }
            }
          }

          this.paymentCompleted = true;
          this.isLoading = false;

          // Return payment details to parent (parent handles success message)
          this.modalController.dismiss({
            success: true,
            paymentData: {
              orderID: order.id,
              payerID: order.payer.payer_id,
              payerEmail: order.payer.email_address,
              payerName: order.payer.name.given_name + ' ' + order.payer.name.surname,
              amount: order.purchase_units[0].amount.value,
              originalAmount: this.originalAmount.toFixed(2),
              currency: order.purchase_units[0].amount.currency_code,
              status: order.status,
              createTime: order.create_time,
              updateTime: order.update_time,
              invoiceID: this.invoice?.InvoiceID,
              vaultToken: vaultToken,
              savedForAutopay: vaultToken !== null
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
        this.showCancelled();
      },

      // On error
      onError: (err: any) => {
        console.error('PayPal error:', err);
        this.showError('An error occurred during payment. Please try again.');
      }
    }).render(this.paypalButtonContainer.nativeElement);
  }

  async showSuccess(order: any, savedForAutopay: boolean = false) {
    let message = `Your payment of $${order.purchase_units[0].amount.value} has been processed successfully.<br><br>Order ID: ${order.id}`;
    if (savedForAutopay) {
      message += '<br><br>Your payment method has been saved for future autopay.';
    }
    const alert = await this.alertController.create({
      header: 'Payment Successful',
      message: message,
      cssClass: 'custom-document-alert',
      buttons: [{ text: 'OK', role: 'cancel', cssClass: 'alert-button-confirm' }]
    });
    await alert.present();
  }

  async showVaultSuccess(payerEmail: string) {
    const alert = await this.alertController.create({
      header: 'Payment Method Saved',
      message: `Your PayPal account (${payerEmail}) has been saved for autopay. Future invoices will be automatically charged to this account.`,
      cssClass: 'custom-document-alert',
      buttons: [{ text: 'OK', role: 'cancel', cssClass: 'alert-button-confirm' }]
    });
    await alert.present();
  }

  async showCancelled() {
    const alert = await this.alertController.create({
      header: 'Payment Cancelled',
      message: 'You have cancelled the payment process.',
      cssClass: 'custom-document-alert',
      buttons: [{ text: 'OK', role: 'cancel', cssClass: 'alert-button-confirm' }]
    });
    await alert.present();
  }

  async showError(message: string) {
    const alert = await this.alertController.create({
      header: 'Payment Error',
      message: message,
      cssClass: 'custom-document-alert',
      buttons: [{ text: 'OK', role: 'cancel', cssClass: 'alert-button-confirm' }]
    });
    await alert.present();
  }

  async showZelleInfo() {
    const alert = await this.alertController.create({
      header: 'Zelle Information',
      cssClass: 'zelle-info-alert',
      message: 'Loading...',
      buttons: [{
        text: 'OK',
        cssClass: 'alert-button-ok'
      }]
    });
    
    await alert.present();
    
    // Manually set innerHTML after alert is presented
    setTimeout(() => {
      const messageElement = document.querySelector('.zelle-info-alert .alert-message');
      
      if (messageElement) {
        messageElement.innerHTML = `
          <div class="zelle-details">We prefer Zelle payments to avoid transaction fees.</div>
          <div class="zelle-pay-to">Pay To</div>
          <div class="zelle-recipient">
            <div class="zelle-name">Name: Patrick Bullock</div>
            <div class="zelle-number">Phone: (512) 298-9395</div>
          </div>
        `;
      } else {
        console.error('Could not find message element');
      }
    }, 50);
  }

  cancel() {
    this.modalController.dismiss({ success: false });
  }
}
