import { Injectable } from '@angular/core';
import { CaspioService } from './caspio.service';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class TableAnalyzerService {
  private tables = [
    'Companies',
    'Invoices', 
    'Offers',
    'Projects',
    'Service_EFE',
    'Service_EFE_Rooms',
    'Service_EFE_Rooms_Templates',
    'Service_EFE_Visuals',
    'Service_EFE_Visuals_Templates',
    'Service_HUD',
    'States',
    'Type'
  ];

  constructor(private caspioService: CaspioService) {}

  analyzeAllTables(): Observable<any> {
    const tableRequests = this.tables.map(tableName => 
      this.getTableDefinition(tableName).pipe(
        catchError(error => {
          console.error(`Error fetching ${tableName}:`, error);
          return of({ tableName, error: error.message });
        })
      )
    );

    return forkJoin(tableRequests);
  }

  getTableDefinition(tableName: string): Observable<any> {
    return this.caspioService.get(`/tables/${tableName}/definition`).pipe(
      map(definition => ({
        tableName,
        definition
      }))
    );
  }

  getTableRecords(tableName: string, limit: number = 5): Observable<any> {
    return this.caspioService.get(`/tables/${tableName}/records?limit=${limit}`).pipe(
      map(response => ({
        tableName,
        records: response
      })),
      catchError(error => {
        console.error(`Error fetching records for ${tableName}:`, error);
        return of({ tableName, records: [], error: error.message });
      })
    );
  }

  analyzeTableRelationships(tableDefinitions: any[]): any {
    const relationships: any = {};
    
    tableDefinitions.forEach(({ tableName, definition }) => {
      if (definition && definition.Result && definition.Result.Fields) {
        relationships[tableName] = {
          fields: definition.Result.Fields,
          foreignKeys: [],
          referencedBy: []
        };

        // Look for foreign key patterns
        definition.Result.Fields.forEach((field: any) => {
          // Common foreign key naming patterns
          if (field.Name.endsWith('_ID') || 
              field.Name.endsWith('Id') || 
              field.Name.endsWith('_id')) {
            
            // Try to identify the referenced table
            let referencedTable = '';
            if (field.Name.includes('Company') || field.Name.includes('company')) {
              referencedTable = 'Companies';
            } else if (field.Name.includes('Project') || field.Name.includes('project')) {
              referencedTable = 'Projects';
            } else if (field.Name.includes('Invoice') || field.Name.includes('invoice')) {
              referencedTable = 'Invoices';
            } else if (field.Name.includes('Offer') || field.Name.includes('offer')) {
              referencedTable = 'Offers';
            } else if (field.Name.includes('State') || field.Name.includes('state')) {
              referencedTable = 'States';
            } else if (field.Name.includes('Type') || field.Name.includes('type')) {
              referencedTable = 'Type';
            }

            if (referencedTable) {
              relationships[tableName].foreignKeys.push({
                field: field.Name,
                referencesTable: referencedTable,
                dataType: field.Type
              });
            }
          }
        });
      }
    });

    // Build reverse relationships
    Object.keys(relationships).forEach(tableName => {
      relationships[tableName].foreignKeys.forEach((fk: any) => {
        if (relationships[fk.referencesTable]) {
          relationships[fk.referencesTable].referencedBy.push({
            table: tableName,
            field: fk.field
          });
        }
      });
    });

    return relationships;
  }
}