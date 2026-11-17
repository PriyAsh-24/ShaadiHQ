export type BudgetRecord = {
  id: string;
  type: string;
  parentId?: string;
  title?: string;
  event?: string;
  owner?: string;
  details?: string;
  amount?: number;
  createdBy?: string;
  createdByName?: string;
};

export function getBudgetRoots<T extends BudgetRecord>(records: T[]): T[];
export function getBudgetChildren<T extends BudgetRecord>(records: T[]): T[];
export function getBudgetTotal(records: BudgetRecord[]): number;
export function matchesBudgetRecord(record: BudgetRecord, query: string): boolean;
export function filterBudgetRoots<T extends BudgetRecord>(records: T[], query: string): T[];
export function getBudgetSpender(record: BudgetRecord): string;
export function getBudgetBalance(record: BudgetRecord): number;
