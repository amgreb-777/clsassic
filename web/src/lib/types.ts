export type Unit = 'г' | 'шт' | 'л'

export interface Product {
  id: number
  name: string
  category: string | null
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
