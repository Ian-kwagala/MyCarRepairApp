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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Authenticated user (set by requireAuth). */
      user?: UserRow;
    }
  }
}
