// Row types: exact column names of the PostgreSQL tables (snake_case).
export interface UserRow {
  id: number;
  full_name: string;
  email: string;
  password: string;
  phone: string | null;
  role: 'owner' | 'mechanic' | 'admin';
  status: 'active' | 'pending' | 'suspended';
  location_lat: number | null;
  location_lng: number | null;
  is_online: boolean;
  garage_name: string | null;
  garage_location: string | null;
  expertise: string | null;
  created_at: Date;
}

export interface VehicleRow {
  id: number;
  owner_id: number;
  make: string;
  model: string;
  year: number;
  plate_number: string;
  fuel_type: string | null;
  transmission: string | null;
  tyre_size: string | null;
  color: string | null;
  mileage: number | null;
  last_service_date: string | null;
  photos: string | null;
  created_at: Date;
}

export type JobStatus = 'pending' | 'accepted' | 'diagnosing' | 'fixing' | 'ready' | 'completed' | 'cancelled';

export interface JobRow {
  id: number;
  owner_id: number;
  mechanic_id: number | null;
  vehicle_id: number | null;
  service_type: string;
  status: JobStatus;
  total_price: number;
  sos_active: boolean;
  start_code: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ChecklistRow {
  id: number;
  job_id: number;
  task_description: string;
  is_completed: boolean;
  photo_url: string | null;
  completed_at: Date | null;
}

export interface QuoteRow {
  id: number;
  job_id: number;
  part_name: string;
  price: number;
  photo_evidence: string | null;
  is_approved: boolean | null;
  created_at: Date;
}

export interface ReviewRow {
  id: number;
  job_id: number;
  mechanic_id: number;
  owner_id: number;
  rating: number;
  feedback: string | null;
  created_at: Date;
}

/** products: the shop catalogue (additive table). */
export interface ProductRow {
  id: number;
  name: string;
  category: string;
  brand: string | null;
  part_number: string | null;
  description: string | null;
  compatible_with: string | null;
  price: number;
  stock: number;
  warranty_months: number | null;
  photos: string | null;
  is_active: boolean;
  /** Marketplace seller listing it; null = sold by MyCarRepair. */
  seller_id: number | null;
  /** Seller listings: 'pending' until staff check them; only 'approved' products are sold. */
  review_status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  created_at: Date;
  updated_at: Date;
  /** The seller's shop name and location, joined in when listing products (not columns). */
  seller_shop?: string | null;
  seller_location?: string | null;
}

/** sellers: marketplace sellers who list products on the seller portal (additive table). */
export interface SellerRow {
  id: number;
  shop_name: string;
  contact_name: string;
  email: string;
  phone: string;
  password: string;
  location: string | null;
  about: string | null;
  payout_number: string | null;
  status: 'pending' | 'active' | 'suspended';
  session_version: number;
  created_at: Date;
}

/** seller_payouts: money sent to a seller for delivered items (additive table). */
export interface SellerPayoutRow {
  id: number;
  seller_id: number;
  amount: number;
  method: string;
  reference: string | null;
  created_at: Date;
}

/** orders: shop orders (additive table). */
export interface OrderRow {
  id: number;
  owner_id: number;
  status: string;
  fulfilment: string;
  payment_method: string;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  contact_phone: string;
  note: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  created_at: Date;
  updated_at: Date;
}

/** order_items: order lines with the name and price at ordering time (additive table). */
export interface OrderItemRow {
  id: number;
  order_id: number;
  product_id: number | null;
  name: string;
  unit_price: number;
  quantity: number;
  seller_id: number | null;
  /** MyCarRepair's cut of this line when it was ordered (0 for MyCarRepair's own products). */
  commission_percent: number;
  seller_status: 'new' | 'ready' | 'collected';
  payout_id: number | null;
  /** First photo of the product, joined in when listing items (not a column). */
  photos?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Authenticated user (set by requireAuth). */
      user?: UserRow;
    }
  }
}
