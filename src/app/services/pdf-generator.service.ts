import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PdfGeneratorService {
  private jsPDF: any = null;
  private isLoading = false;

  constructor() { }

  /**
   * Lazy load jsPDF library only when needed
   */
  async loadJsPDF(): Promise<any> {
    if (this.jsPDF) {
      return this.jsPDF;
    }

    if (this.isLoading) {
      // Wait for the current loading to complete
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.jsPDF) {
            clearInterval(checkInterval);
            resolve(this.jsPDF);
          }
        }, 100);
      });
    }

    this.isLoading = true;
    
    try {
      // Dynamically import jsPDF only when needed
      const jsPDFModule = await import('jspdf');
      this.jsPDF = jsPDFModule.default || jsPDFModule;
      this.isLoading = false;
      return this.jsPDF;
    } catch (error) {
      this.isLoading = false;
      console.error('Failed to load jsPDF:', error);
      throw error;
    }
  }

  /**
   * Create a new jsPDF instance
   */
  async createPDF(options: any = {}): Promise<any> {
    const jsPDF = await this.loadJsPDF();
    return new jsPDF(options);
  }

  /**
   * Check if jsPDF is loaded
   */
  isJsPDFLoaded(): boolean {
    return this.jsPDF !== null;
  }
}