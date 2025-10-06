import { Injectable } from '@angular/core';
import { CaspioService } from './caspio.service';
import { Observable, forkJoin } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

export interface TableSchema {
  name: string;
  fields: FieldSchema[];
  relationships: Relationship[];
}

export interface FieldSchema {
  name: string;
  type: string;
  required: boolean;
  primaryKey: boolean;
  foreignKey?: string;
  maxLength?: number;
  defaultValue?: any;
}

export interface Relationship {
  table: string;
  field: string;
  relatedTable: string;
  relatedField: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

export interface GeneratedModel {
  interfaceName: string;
  interfaceCode: string;
  serviceName: string;
  serviceCode: string;
}

@Injectable({
  providedIn: 'root'
})
export class ModelGeneratorService {
  private discoveredTables: any[] = [];
  private tableSchemas: Map<string, TableSchema> = new Map();

  constructor(private caspioService: CaspioService) {}

  discoverAllTablesAndSchemas(): Observable<TableSchema[]> {
    return this.caspioService.get('/tables').pipe(
      switchMap((tables: any) => {
        this.discoveredTables = Array.isArray(tables) ? tables : tables.Result || [];
        
        // Create observables for each table schema
        const schemaRequests = this.discoveredTables.map(table => {
          const tableName = table.Name || table.name || table;
          return this.getTableSchemaDetailed(tableName);
        });

        // Execute all schema requests in parallel
        return forkJoin(schemaRequests.length > 0 ? schemaRequests : []);
      }),
      map((schemas: any[]) => {
        const tableSchemas: TableSchema[] = schemas.filter(schema => schema !== null);
        
        // Store schemas in map for quick access
        tableSchemas.forEach(schema => {
          this.tableSchemas.set(schema.name, schema);
        });
        return tableSchemas;
      })
    );
  }

  private getTableSchemaDetailed(tableName: string): Observable<TableSchema | null> {
    // Try different possible schema endpoints
    return this.caspioService.get(`/tables/${tableName}/fields`).pipe(
      map((schemaResponse: any) => {
        try {
          const fields = this.parseFieldsFromSchema(schemaResponse);
          const relationships = this.detectRelationships(fields, tableName);
          
          const schema: TableSchema = {
            name: tableName,
            fields: fields,
            relationships: relationships
          };
          return schema;
        } catch (error) {
          console.error(`Error parsing schema for ${tableName}:`, error);
          // If fields endpoint fails, try records endpoint to infer structure
          return this.inferSchemaFromRecords(tableName);
        }
      })
    );
  }

  private inferSchemaFromRecords(tableName: string): TableSchema | null {
    // Fallback: get a few records and infer field types
    this.caspioService.get(`/tables/${tableName}/records?q_limit=1`).subscribe({
      next: (recordsResponse: any) => {
        try {
          const records = recordsResponse.Result || recordsResponse;
          if (records && records.length > 0) {
            const sampleRecord = records[0];
            const inferredFields = Object.keys(sampleRecord).map(fieldName => ({
              name: fieldName,
              type: this.inferTypeFromValue(sampleRecord[fieldName]),
              required: false,
              primaryKey: fieldName.toLowerCase().includes('id') && fieldName.toLowerCase() === fieldName.toLowerCase().replace(/[^a-z]/g, '') + 'id'
            }));

            const schema: TableSchema = {
              name: tableName,
              fields: inferredFields,
              relationships: this.detectRelationships(inferredFields, tableName)
            };
          }
        } catch (error) {
          console.error(`Error inferring schema for ${tableName}:`, error);
        }
      },
      error: (error) => {
        console.error(`Cannot access records for ${tableName}:`, error);
      }
    });

    return null;
  }

  private inferTypeFromValue(value: any): string {
    if (value === null || value === undefined) return 'any';
    if (typeof value === 'string') {
      // Check if it's a date string
      if (value.match(/^\d{4}-\d{2}-\d{2}/) || value.match(/^\d{2}\/\d{2}\/\d{4}/)) {
        return 'Date';
      }
      return 'string';
    }
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'any[]';
    return 'any';
  }

  private parseFieldsFromSchema(schemaResponse: any): FieldSchema[] {
    const fields: FieldSchema[] = [];
    
    // Handle different possible schema response formats
    const fieldData = schemaResponse.Result || schemaResponse.fields || schemaResponse;
    
    if (Array.isArray(fieldData)) {
      fieldData.forEach((field: any) => {
        fields.push(this.parseField(field));
      });
    } else if (fieldData && typeof fieldData === 'object') {
      // If it's an object, try to extract field information
      Object.keys(fieldData).forEach(key => {
        if (fieldData[key] && typeof fieldData[key] === 'object') {
          const field = this.parseField({ name: key, ...fieldData[key] });
          fields.push(field);
        }
      });
    }

    return fields;
  }

  private parseField(fieldData: any): FieldSchema {
    return {
      name: fieldData.Name || fieldData.name || fieldData.FieldName,
      type: this.mapCaspioTypeToTSType(fieldData.Type || fieldData.type || fieldData.DataType),
      required: fieldData.Required || fieldData.required || false,
      primaryKey: fieldData.IsPrimaryKey || fieldData.primaryKey || false,
      foreignKey: fieldData.ForeignKey || fieldData.foreignKey,
      maxLength: fieldData.MaxLength || fieldData.maxLength,
      defaultValue: fieldData.DefaultValue || fieldData.defaultValue
    };
  }

  private mapCaspioTypeToTSType(caspioType: string): string {
    const typeMap: { [key: string]: string } = {
      'TEXT': 'string',
      'NUMBER': 'number',
      'AUTONUMBER': 'number',
      'DATE': 'Date',
      'DATETIME': 'Date',
      'TIMESTAMP': 'Date',
      'BOOLEAN': 'boolean',
      'YES/NO': 'boolean',
      'FILE': 'string',
      'IMAGE': 'string',
      'EMAIL': 'string',
      'PHONE': 'string',
      'CURRENCY': 'number',
      'PERCENT': 'number',
      'LIST': 'string[]'
    };

    return typeMap[caspioType?.toUpperCase()] || 'any';
  }

  private detectRelationships(fields: FieldSchema[], tableName: string): Relationship[] {
    const relationships: Relationship[] = [];
    
    fields.forEach(field => {
      if (field.foreignKey) {
        // Parse foreign key format (assuming format like "TableName.FieldName")
        const parts = field.foreignKey.split('.');
        if (parts.length === 2) {
          relationships.push({
            table: tableName,
            field: field.name,
            relatedTable: parts[0],
            relatedField: parts[1],
            type: 'one-to-many' // Default, can be refined
          });
        }
      }
      
      // Detect common naming patterns for relationships
      if (field.name.toLowerCase().includes('id') && !field.primaryKey) {
        const relatedTable = this.guessRelatedTableFromFieldName(field.name);
        if (relatedTable) {
          relationships.push({
            table: tableName,
            field: field.name,
            relatedTable: relatedTable,
            relatedField: 'id', // Assumption
            type: 'one-to-many'
          });
        }
      }
    });

    return relationships;
  }

  private guessRelatedTableFromFieldName(fieldName: string): string | null {
    // Common patterns: userId -> User, customerId -> Customer, etc.
    const patterns = [
      /^(.+)Id$/i,
      /^(.+)_id$/i,
      /^id_(.+)$/i
    ];

    for (const pattern of patterns) {
      const match = fieldName.match(pattern);
      if (match) {
        return this.capitalizeFirst(match[1]);
      }
    }

    return null;
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  generateTypeScriptInterface(schema: TableSchema): string {
    const interfaceName = `${this.capitalizeFirst(schema.name)}Model`;
    let interfaceCode = `export interface ${interfaceName} {\n`;
    
    schema.fields.forEach(field => {
      const optional = field.required ? '' : '?';
      interfaceCode += `  ${field.name}${optional}: ${field.type};\n`;
    });
    
    interfaceCode += `}\n\n`;
    
    // Add related interfaces for relationships
    schema.relationships.forEach(rel => {
      if (rel.type === 'one-to-many') {
        interfaceCode += `// Related to ${rel.relatedTable}\n`;
      }
    });

    return interfaceCode;
  }

  generateServiceClass(schema: TableSchema): string {
    const serviceName = `${this.capitalizeFirst(schema.name)}Service`;
    const modelName = `${this.capitalizeFirst(schema.name)}Model`;
    const tableName = schema.name;
    
    return `
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CaspioService } from './caspio.service';
import { ${modelName} } from '../models/${schema.name}.model';

@Injectable({
  providedIn: 'root'
})
export class ${serviceName} {
  private tableName = '${tableName}';

  constructor(private caspioService: CaspioService) {}

  getAll(pageSize: number = 1000, pageNumber: number = 1): Observable<${modelName}[]> {
    return this.caspioService.get(\`/tables/\${this.tableName}/records?q_limit=\${pageSize}&q_offset=\${(pageNumber - 1) * pageSize}\`);
  }

  getById(id: any): Observable<${modelName}> {
    return this.caspioService.get(\`/tables/\${this.tableName}/records/\${id}\`);
  }

  create(data: Partial<${modelName}>): Observable<${modelName}> {
    return this.caspioService.post(\`/tables/\${this.tableName}/records\`, data);
  }

  update(id: any, data: Partial<${modelName}>): Observable<${modelName}> {
    return this.caspioService.put(\`/tables/\${this.tableName}/records/\${id}\`, data);
  }

  delete(id: any): Observable<any> {
    return this.caspioService.delete(\`/tables/\${this.tableName}/records/\${id}\`);
  }

  search(criteria: any, pageSize: number = 1000): Observable<${modelName}[]> {
    const queryParams = Object.keys(criteria)
      .map(key => \`q.\${key}=\${encodeURIComponent(criteria[key])}\`)
      .join('&');
    return this.caspioService.get(\`/tables/\${this.tableName}/records?\${queryParams}&q_limit=\${pageSize}\`);
  }
}`;
  }

  generateAllModels(): Observable<GeneratedModel[]> {
    return this.discoverAllTablesAndSchemas().pipe(
      map((schemas: TableSchema[]) => {
        const generatedModels: GeneratedModel[] = [];
        
        schemas.forEach(schema => {
          const model: GeneratedModel = {
            interfaceName: `${this.capitalizeFirst(schema.name)}Model`,
            interfaceCode: this.generateTypeScriptInterface(schema),
            serviceName: `${this.capitalizeFirst(schema.name)}Service`,
            serviceCode: this.generateServiceClass(schema)
          };
          generatedModels.push(model);
        });

        return generatedModels;
      })
    );
  }

  getTableSchemas(): Map<string, TableSchema> {
    return this.tableSchemas;
  }
}