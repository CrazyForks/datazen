import type { ComponentType } from 'react';
import type { TableSchema } from './sql-editor/databaseTypes';

/** Read-only table inventory for the query builder's current query tab. */
export interface QueryBuilderCatalog {
  tables: readonly { name: string; schema: string | null }[];
  columnMap: Readonly<Record<string, readonly string[]>>;
  typedColumnMap: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** A relation suggestion from the host's schema analysis. */
export interface QueryBuilderRelationCandidate {
  id: string;
  fromTable: string;
  toTable: string;
  columnPairs: readonly { left: string; right: string }[];
  tier: 'high' | 'medium';
  ambiguous: boolean;
}

/** Props passed by the host to the Pro-owned builder panel. */
export interface QueryBuilderPanelProps {
  panelId: string;
  connectionId: string;
  dbSessionId: string;
  databaseType: string;
  database: string;
  schema: string | null;
  currentSql: string;
  catalog: QueryBuilderCatalog;
  dialectFamily: string;
  enableFkPrediction: boolean;
  ensureColumns(names: readonly string[]): Promise<void>;
  loadTableSchema(name: string): Promise<TableSchema | null>;
  predictRelations(schemas: readonly TableSchema[]): readonly QueryBuilderRelationCandidate[];
  formatSql(sql: string): string;
  onCommit(sql: string | null, mode: 'replace' | 'append'): void;
  onCancel(): void;
}

/** Pro Query Builder lifecycle and rendering contract. */
export interface QueryBuilderContribution {
  getOpenPanelId(): string | null;
  subscribe(listener: () => void): () => void;
  openFor(panelId: string, contextKey: string): void;
  hideFor(): void;
  closeFor(reason: 'ok' | 'cancel'): void;
  destroyFor(panelId: string): void;
  Panel: ComponentType<QueryBuilderPanelProps>;
  dispose(): void;
}
