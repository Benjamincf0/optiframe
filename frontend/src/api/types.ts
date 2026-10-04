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
  code: 'LOW_RESOLUTION' | 'LIKELY_COMPRESSED' | 'FAINT_EDGE'
  side: 'left' | 'right'
  message: string
}

/** Lens placement zone in the captured image, normalised [x0, y0, x1, y1] (0–1). Sent as the segmentation hint. */
export type LensHint = [number, number, number, number]

export interface MeasureResponse {
  left: LensResult
  right: LensResult
  asymmetric: boolean
  warnings: MeasureWarning[]
}

export type Pattern = 'none' | 'woven' | 'honeycomb' | 'brushed' | 'dots'
export type Material = 'petg' | 'pla' | 'asa'
export type Color = 'matte_black' | 'tortoiseshell' | 'crystal' | 'navy' | 'bone' | 'olive'

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
  /** Lens box centres in STL coordinates (mm); wearer's right lens is on −x. Null if the header is missing. */
  lensCentersMm: { right: [number, number]; left: [number, number] } | null
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
  design: GenerateRequest
  design_signature: string
  material: Material
  color: Color
  email: string
  shipping_address: ShippingAddress
  payment?: { provider: 'fake'; token: string }
  sponsor_code?: string
}

export interface ShippingAddress {
  name: string
  line1: string
  line2?: string
  city: string
  postal_code: string
  region?: string
  country: string
}

export interface OrderResponse {
  order_id: string
  access_token: string
  status: OrderStatus
  estimated_delivery: { from: string; to: string }
  email: string
  specs: OrderSpecs
  pricing: Pricing
}

export type OrderStatus = 'received' | 'printing' | 'shipped' | 'delivered' | 'cancelled'

export interface OrderDetail {
  order_id: string
  status: OrderStatus
  estimated_delivery: { from: string; to: string }
  email: string
  shipping_address: ShippingAddress
  specs: OrderSpecs
  pricing: Pricing
  tracking_number?: string
  can_cancel: boolean
}

export interface OrderSpecs {
  left_lens: { A: number; B: number }
  right_lens: { A: number; B: number }
  bridge_mm: number
  depth_mm: number
  rim_offset_mm: number
  clip_clearance_mm: number
  pattern: Pattern
  engraving_text: string
  material: Material
  color: Color
}

export interface Pricing {
  grams: number
  material_cost: number
  shipping: number
  discount: number
  total: number
  currency: string
  sponsored: boolean
}

export interface ApiError {
  code: string
  message: string
  side?: 'left' | 'right'
  details?: unknown
}
