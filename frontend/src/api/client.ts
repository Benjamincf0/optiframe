import type {
  MeasureResponse,
  GenerateRequest,
  STLHeaders,
  QuoteRequest,
  QuoteResponse,
  OrderRequest,
  OrderResponse,
  OrderDetail,
  ReferenceSpec,
  LensHint,
} from './types'

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

class ApiClientError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>
  let code = `HTTP_${res.status}`
  let message = `Request failed (${res.status})`
  try {
    const body = await res.json()
    if (body?.error?.code) code = body.error.code
    if (body?.error?.message) message = body.error.message
  } catch {
    // ignore parse error
  }
  throw new ApiClientError(code, message, res.status)
}

export async function measureLenses(
  leftImage: File,
  rightImage: File,
  reference: ReferenceSpec,
  leftHint?: LensHint | null,
  rightHint?: LensHint | null,
): Promise<MeasureResponse> {
  const form = new FormData()
  form.append('left_image', leftImage)
  form.append('right_image', rightImage)
  form.append('reference', JSON.stringify(reference))
  if (leftHint) form.append('left_hint', JSON.stringify(leftHint))
  if (rightHint) form.append('right_hint', JSON.stringify(rightHint))

  const res = await fetch(`${BASE}/measure`, { method: 'POST', body: form })
  return handleResponse<MeasureResponse>(res)
}

export async function generateSTL(req: GenerateRequest): Promise<{ blob: Blob; headers: STLHeaders }> {
  const res = await fetch(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    await handleResponse(res) // throws
  }

  const blob = await res.blob()
  const headers: STLHeaders = {
    volumeMm3: parseFloat(res.headers.get('X-Volume-Mm3') ?? '0'),
    maxDeviationMm: parseFloat(res.headers.get('X-Max-Deviation-Mm') ?? '0'),
    frameWidthMm: parseFloat(res.headers.get('X-Frame-Width-Mm') ?? '0'),
    lensCentersMm: parseLensCenters(res.headers.get('X-Lens-Centers-Mm')),
    designSignature: res.headers.get('X-Design-Signature') ?? '',
  }
  return { blob, headers }
}

function parseLensCenters(raw: string | null): STLHeaders['lensCentersMm'] {
  if (!raw) return null
  try {
    return JSON.parse(raw) as STLHeaders['lensCentersMm']
  } catch {
    return null
  }
}

export async function getQuote(req: QuoteRequest): Promise<QuoteResponse> {
  const res = await fetch(`${BASE}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return handleResponse<QuoteResponse>(res)
}

export async function placeOrder(stlBlob: Blob, order: OrderRequest): Promise<OrderResponse> {
  const form = new FormData()
  form.append('stl', stlBlob, 'monture.stl')
  form.append('order', JSON.stringify(order))

  const res = await fetch(`${BASE}/orders`, {
    method: 'POST',
    body: form,
  })
  return handleResponse<OrderResponse>(res)
}

export async function getOrder(id: string, token?: string): Promise<OrderDetail> {
  const url = token ? `${BASE}/orders/${id}?t=${encodeURIComponent(token)}` : `${BASE}/orders/${id}`
  const res = await fetch(url)
  return handleResponse<OrderDetail>(res)
}

export async function cancelOrder(id: string, token?: string): Promise<void> {
  const url = token
    ? `${BASE}/orders/${id}/cancel?t=${encodeURIComponent(token)}`
    : `${BASE}/orders/${id}/cancel`
  const res = await fetch(url, { method: 'POST' })
  return handleResponse<void>(res)
}

export { ApiClientError }
