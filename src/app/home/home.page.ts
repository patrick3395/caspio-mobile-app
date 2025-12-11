import { Component, OnInit } from '@angular/core';
import { CaspioService } from '../services/caspio.service';
import { ModelGeneratorService } from '../services/model-generator.service';
import { TableAnalyzerService } from '../services/table-analyzer.service';
import { environment } from '../../environments/environment';

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
  tableDefinitions: any[] = [];
  relationships: any = {};
  analyzingTables = false;

  constructor(
    private caspioService: CaspioService,
    private modelGenerator: ModelGeneratorService,
    private tableAnalyzer: TableAnalyzerService
  ) {}

  ngOnInit() {
    this.checkAuthentication();
  }

  checkAuthentication() {
    // When using API Gateway, AWS handles authentication
    if (environment.useApiGateway) {
      this.isAuthenticated = true;
      this.authStatus = 'Using AWS API Gateway (no frontend auth needed)';
      return;
    }
    this.isAuthenticated = this.caspioService.isAuthenticated();
    this.authStatus = this.isAuthenticated ? 'Authenticated' : 'Not authenticated';
  }

  authenticate() {
    // When using API Gateway, AWS handles authentication - no need to auth here
    if (environment.useApiGateway) {
      this.authStatus = 'Using AWS API Gateway (no frontend auth needed)';
      this.isAuthenticated = true;
      return;
    }

    this.authStatus = 'Authenticating...';
    this.caspioService.authenticate().subscribe({
      next: (response) => {
        this.authStatus = 'Authentication successful!';
        this.isAuthenticated = true;
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
        
        // Log the generated code for review
        generatedModels.forEach(model => {
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

  analyzeSpecificTables() {
    this.analyzingTables = true;
    this.authStatus = 'Analyzing table structures...';
    
    this.tableAnalyzer.analyzeAllTables().subscribe({
      next: (definitions) => {
        this.tableDefinitions = definitions;
        this.relationships = this.tableAnalyzer.analyzeTableRelationships(definitions);
        
        definitions.forEach(({ tableName, definition, error }: any) => {
          if (error) {
          } else if (definition && definition.Result && definition.Result.Fields) {
            definition.Result.Fields.forEach((field: any) => {
            });
          }
        });
        Object.keys(this.relationships).forEach(tableName => {
          const rel = this.relationships[tableName];
          if (rel.foreignKeys.length > 0 || rel.referencedBy.length > 0) {
            if (rel.foreignKeys.length > 0) {
              rel.foreignKeys.forEach((fk: any) => {
              });
            }
            if (rel.referencedBy.length > 0) {
              rel.referencedBy.forEach((ref: any) => {
              });
            }
          }
        });
        
        this.authStatus = `Analysis complete: ${definitions.length} tables analyzed`;
        this.analyzingTables = false;
        
        // Save to localStorage for persistence
        localStorage.setItem('caspio_table_definitions', JSON.stringify(definitions));
        localStorage.setItem('caspio_table_relationships', JSON.stringify(this.relationships));
      },
      error: (error) => {
        console.error('Error analyzing tables:', error);
        this.authStatus = 'Error analyzing tables: ' + error.message;
        this.analyzingTables = false;
      }
    });
  }
}
