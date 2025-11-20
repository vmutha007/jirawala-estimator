
export interface InventoryItem {
  id: string;
  productName: string;
  vendor: string;
  date: string;
  mrp: number;
  purchaseDiscountPercent: number;
  gstPercent: number;
  landingPrice: number; // The basic cost to you
  note?: string; // Search tags or internal notes
}

export interface EstimateItem {
  id: string;
  inventoryId?: string;
  productName: string;
  mrp: number;
  gstPercent: number;
  
  // Your Cost / Metrics
  landingPrice: number;
  purchaseDiscountPercent: number; // The discount you got from vendor
  
  // Your Settings
  marginPercent: number; 
  
  // Derived / Editable
  sellingBasic: number; // landingPrice + margin
  quantity: number;
}

export interface BusinessProfile {
  name: string;
  address: string;
  gstin: string;
  phone: string;
  email: string;
  logoUrl: string; // Base64 string for the logo
  terms: string;
}

export interface CustomerProfile {
  name: string;
  firmName?: string; // Added for business identification
  phone: string;
  address: string;
  gstin: string;
}

export type EstimateStatus = 'draft' | 'confirmed';

export interface EstimateRecord {
  id: string;
  invoiceNumber?: string; // e.g. JIRVIR1
  date: string;
  lastModified: number;
  status: EstimateStatus;
  customer: CustomerProfile;
  items: EstimateItem[];
  additionalCharges: {
    packing: number;
    shipping: number;
    adjustment: number;
  };
}