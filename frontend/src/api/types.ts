export type ReferenceType = 'credit_card' | 'a4' | 'custom' | 'aruco'

export interface ReferenceSpec {
  type: ReferenceType
  width_mm?: number
  height_mm?: number
  dictionary?: string
  marker_size_mm?: number
}

export interface LensResult {
  contour_mm: [number, number][]
  A: number
  B: number
  perimeter: number
  box_mm: { x_min: number; x_max: number; y_min: number; y_max: number }
  confidence: number
  accuracy_mm: number
  scale_px_per_mm: number
  rectified_image: string // base64 data URL
  rectified_origin_mm: [number, number]
}

export interface MeasureWarning {
  code: 'LOW_RESOLUTION' | 'LIKELY_COMPRESSED' | 'ANGLE_TOO_STEEP'
  side: 'left' | 'right'
  message: string
}

export interface MeasureResponse {
  left: LensResult
  right: LensResult
  asymmetric: boolean
  warnings: MeasureWarning[]
}

export type Pattern = 'none' | 'woven' | 'honeycomb' | 'brushed' | 'dots'
export type Material = 'petg' | 'pla' | 'asa'

export interface GenerateRequest {
  left_contour_mm: [number, number][]
  right_contour_mm: [number, number][]
  bridge_mm: number
  depth_mm: number
  rim_offset_mm: number
  clip_clearance_mm: number
  pattern: Pattern
  engraving_text: string
}

export interface STLHeaders {
  volumeMm3: number
  maxDeviationMm: number
  frameWidthMm: number
  lensInterCentersMm: number
  designSignature: string
}

export interface QuoteRequest {
  volume_mm3: number
  material: Material
  sponsor_code?: string
}

export interface QuoteResponse {
  grams: number
  price_per_g: number
  material_cost: number
  shipping: number
  discount: number
  total: number
  currency: string
  sponsored: boolean
}

export interface OrderRequest {
  design_signature: string
  material: Material
  color: string
  email: string
  shipping_address: string
  sponsor_code?: string
}

export interface OrderResponse {
  order_id: string
  access_token: string
  status: OrderStatus
  estimated_delivery: { from: string; to: string }
  total: number
}

export type OrderStatus = 'received' | 'printing' | 'shipped' | 'delivered' | 'cancelled'

export interface OrderDetail {
  order_id: string
  status: OrderStatus
  estimated_delivery: { from: string; to: string }
  material: Material
  color: string
  email: string
  left_A: number
  left_B: number
  right_A: number
  right_B: number
  bridge_mm: number
  engraving_text: string
  total: number
  tracking_number?: string
}

export interface ApiError {
  code: string
  message: string
  side?: 'left' | 'right'
  details?: unknown
}
