export interface Product {
  id: number;
  code: string | null;
  name: string;
  uom: string;
  stock: number;
  location: string;
  category: string | null;
  expiry: string | null;
  needsExpiry: boolean;
  note: string;
}

export interface Counts {
  all: number;
  onhand: number;
  expired: number;
  soon: number;
  watch: number;
  ok: number;
  flag: number;
  none: number;
  oos: number;
}
