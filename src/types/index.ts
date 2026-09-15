export type UserRole = 'admin' | 'cashier' | 'kitchen';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthContextValue {
  session: import('@supabase/supabase-js').Session | null;
  profile: Profile | null;
  loading: boolean;
  authError: string | null;
  signOut: () => Promise<void>;
}

// ===== Restaurant Operations =====

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string;
  category_id: string | null;
  image_url: string | null;
  available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  category_ref?: Category | null;
}

export type OrderStatus = 'new' | 'preparing' | 'ready' | 'served';

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name: string;
  price: number;
  quantity: number;
  notes: string | null;
  created_at: string;
}

export type OrderSource = 'staff' | 'qr';

export interface Order {
  id: string;
  order_number: number;
  status: OrderStatus;
  payment_status: 'unpaid' | 'paid';
  discount_amount: number;
  notes: string | null;
  total: number;
  item_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  order_items?: OrderItem[];
  // Table / QR ordering (optional — absent on rows fetched before this
  // feature existed, and unused by the existing POS/history/report screens)
  table_id?: string | null;
  order_source?: OrderSource;
  confirmed_at?: string | null;
  table?: Pick<RestaurantTable, 'id' | 'table_number' | 'name'> | null;
}

// ===== Table Management / QR Ordering =====

export interface RestaurantTable {
  id: string;
  table_number: number;
  name: string | null;
  qr_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ===== Promotions =====

export interface PromotionMedia {
  id: string;
  promotion_id: string;
  media_url: string;
  media_type: 'image' | 'video';
  sort_order: number;
  created_at: string;
}

export interface Promotion {
  id: string;
  title: string;
  url: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  media?: PromotionMedia[];
}

// Cart line item used in the POS (before order is submitted)
export interface CartItem {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  notes: string;
}

// ===== Inventory =====

export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  stock_quantity: number;
  low_stock_threshold: number;
  created_at: string;
  updated_at: string;
}

// ===== Daily Report (Analytics / Z Report) =====

export interface BestSellingItem {
  name: string;
  quantity: number;
  revenue: number;
}

export interface DailyReport {
  target_date: string;
  period_start: string;
  total_orders: number;
  served_orders: number;
  paid_orders: number;
  gross_sales: number;
  total_revenue: number;
  total_discount: number;
  avg_order_value: number;
  orders_new: number;
  orders_preparing: number;
  orders_ready: number;
  orders_served: number;
  unpaid_served_orders: number;
  unpaid_amount: number;
  items_sold: number;
  best_selling_items: BestSellingItem[];
}

export interface RangeReport {
  start_date: string;
  end_date: string;
  total_orders: number;
  served_orders: number;
  paid_orders: number;
  gross_sales: number;
  total_revenue: number;
  total_discount: number;
  avg_order_value: number;
  unpaid_served_orders: number;
  unpaid_amount: number;
  items_sold: number;
  best_selling_items: BestSellingItem[];
}

// A permanent, immutable snapshot of one closed business day.
export interface ZReportRow {
  id: string;
  business_date: string;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: string;
  total_orders: number;
  served_orders: number;
  paid_orders: number;
  unpaid_orders: number;
  items_sold: number;
  gross_sales: number;
  total_discount: number;
  net_revenue: number;
  unpaid_amount: number;
  avg_order_value: number;
  created_at: string;
}
