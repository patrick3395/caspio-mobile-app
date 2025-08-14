import { Component, OnInit } from '@angular/core';
import { CaspioService } from '../services/caspio.service';
import { ModelGeneratorService } from '../services/model-generator.service';
import { TableAnalyzerService } from '../services/table-analyzer.service';

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

  analyzeSpecificTables() {
    this.analyzingTables = true;
    this.authStatus = 'Analyzing table structures...';
    
    this.tableAnalyzer.analyzeAllTables().subscribe({
      next: (definitions) => {
        this.tableDefinitions = definitions;
        this.relationships = this.tableAnalyzer.analyzeTableRelationships(definitions);
        
        console.log('====================================');
        console.log('TABLE STRUCTURE ANALYSIS COMPLETE');
        console.log('====================================');
        
        definitions.forEach(({ tableName, definition, error }: any) => {
          if (error) {
            console.log(`\n❌ ${tableName}: ${error}`);
          } else if (definition && definition.Result && definition.Result.Fields) {
            console.log(`\n📊 TABLE: ${tableName}`);
            console.log('Fields:');
            definition.Result.Fields.forEach((field: any) => {
              console.log(`  - ${field.Name} (${field.Type})${field.IsUnique ? ' [UNIQUE]' : ''}${field.UniqueAllowNulls ? ' [ALLOW NULLS]' : ''}`);
            });
          }
        });
        
        console.log('\n====================================');
        console.log('TABLE RELATIONSHIPS');
        console.log('====================================');
        Object.keys(this.relationships).forEach(tableName => {
          const rel = this.relationships[tableName];
          if (rel.foreignKeys.length > 0 || rel.referencedBy.length > 0) {
            console.log(`\n${tableName}:`);
            if (rel.foreignKeys.length > 0) {
              console.log('  Foreign Keys:');
              rel.foreignKeys.forEach((fk: any) => {
                console.log(`    - ${fk.field} -> ${fk.referencesTable}`);
              });
            }
            if (rel.referencedBy.length > 0) {
              console.log('  Referenced By:');
              rel.referencedBy.forEach((ref: any) => {
                console.log(`    - ${ref.table}.${ref.field}`);
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
