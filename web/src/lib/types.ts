export type Unit = 'г' | 'шт' | 'л'

export interface Product {
  id: number
  name: string
  category: string | null
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
  price_kg: number | null
  price_pcs: number | null
  price_source: string | null
  price_item: string | null
  price_pack: string | null
  price_url: string | null
  price_note: string | null
  price_at: string | null
}

/** Ціна продукту в конкретному магазині (product_prices). */
export interface StorePrice {
  product_id: number
  store: string
  price_kg: number | null
  price_pcs: number | null
  item: string | null
  pack: string | null
  url: string | null
  note: string | null
  collected_at: string
  /** звичайна ціна упаковки — для перевірки зміни фасування */
  pack_price?: number | null
}

/** Собівартість 1 порції (view dish_cost). */
export interface DishCost {
  dish_id: number
  cost: number
  missing: number
  price_from: string | null
  price_to: string | null
}

export interface Dish {
  id: number
  name: string
  category: string | null
  portion_weight_g: number | null
  is_active: boolean
}

export interface DishOverview extends Dish {
  ingredients_count: number
  net_g_total: number
}

export interface Ingredient {
  id: number
  dish_id: number
  product_id: number
  gross: number
  net: number
  unit: Unit
  position: number
  products: { name: string } | null
}

export type OrderStatus = 'draft' | 'confirmed' | 'purchased' | 'done'

export interface Order {
  id: number
  title: string
  event_date: string | null
  guests: number | null
  notes: string | null
  status: OrderStatus
  created_at: string
  updated_at: string
}

export interface OrderItem {
  order_id: number
  dish_id: number
  quantity: number
}

export interface PurchaseRow {
  product_id: number
  product: string
  category: string | null
  unit: Unit
  dishes_count: number
  dishes: string[]
  gross_total: number
  net_total: number
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Чернетка',
  confirmed: 'Підтверджено',
  purchased: 'Закуплено',
  done: 'Виконано',
}
