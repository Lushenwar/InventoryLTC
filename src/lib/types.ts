export interface Product {
  id: number;
  code: string | null;
  name: string;
  uom: string;
  stock: number;
  location: string;
  expiry: string | null;
  needsExpiry: boolean;
  note: string;
  unitsPerBox: number | null; // PPE only: pieces per box, drives total-qty entry in receive/pickup
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
