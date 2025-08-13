import { Component, OnInit } from '@angular/core';
import { CaspioService } from '../services/caspio.service';
import { ModelGeneratorService } from '../services/model-generator.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit {
  isAuthenticated = false;
  authStatus = 'Not authenticated';
  generationStatus = '';

  constructor(
    private caspioService: CaspioService,
    private modelGenerator: ModelGeneratorService
  ) {}

  ngOnInit() {
    this.checkAuthentication();
  }

  checkAuthentication() {
    this.isAuthenticated = this.caspioService.isAuthenticated();
    this.authStatus = this.isAuthenticated ? 'Authenticated' : 'Not authenticated';
  }

  authenticate() {
    this.authStatus = 'Authenticating...';
    this.caspioService.authenticate().subscribe({
      next: (response) => {
        this.authStatus = 'Authentication successful!';
        this.isAuthenticated = true;
        console.log('Authentication successful', response);
      },
      error: (error) => {
        this.authStatus = 'Authentication failed';
        this.isAuthenticated = false;
        console.error('Authentication failed', error);
      }
    });
  }

  testApiCall() {
    // Discover all available tables
    this.caspioService.get('/tables').subscribe({
      next: (response) => {
        console.log('Available tables:', response);
      },
      error: (error) => {
        console.error('API call failed', error);
      }
    });
  }

  discoverAllTables() {
    this.generationStatus = 'Discovering tables and schemas...';
    this.modelGenerator.discoverAllTablesAndSchemas().subscribe({
      next: (schemas) => {
        this.generationStatus = `Discovered ${schemas.length} tables with schemas`;
        console.log('All table schemas:', schemas);
      },
      error: (error) => {
        this.generationStatus = 'Failed to discover tables';
        console.error('Failed to discover tables:', error);
      }
    });
  }

  generateAllModels() {
    this.generationStatus = 'Generating TypeScript models and services...';
    this.modelGenerator.generateAllModels().subscribe({
      next: (generatedModels) => {
        this.generationStatus = `Generated ${generatedModels.length} models and services`;
        console.log('Generated models:', generatedModels);
        
        // Log the generated code for review
        generatedModels.forEach(model => {
          console.log(`\n=== ${model.interfaceName} ===`);
          console.log(model.interfaceCode);
          console.log(`\n=== ${model.serviceName} ===`);
          console.log(model.serviceCode);
        });
      },
      error: (error) => {
        this.generationStatus = 'Failed to generate models';
        console.error('Failed to generate models:', error);
      }
    });
  }

  // New method to test individual table access
  testTableAccess() {
    const testTables = ['Users', 'Projects', 'Companies', 'Contacts'];
    
    testTables.forEach(tableName => {
      this.caspioService.get(`/tables/${tableName}/records?q_limit=1`).subscribe({
        next: (response) => {
          console.log(`Sample data from ${tableName}:`, response);
        },
        error: (error) => {
          console.error(`Failed to access ${tableName}:`, error);
        }
      });
    });
  }

  logout() {
    this.caspioService.logout();
    this.checkAuthentication();
  }
}
