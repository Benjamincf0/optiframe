import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import STLThumbnail from '../components/STLThumbnail'
import { useSession } from '../context/SessionContext'
import { getQuote, placeOrder, ApiClientError } from '../api/client'
import type { Color, Material, ShippingAddress } from '../api/types'

const MATERIALS: { id: Material; name: string; detail: string }[] = [
  { id: 'petg', name: 'PETG', detail: 'Flexible, UV resistant' },
  { id: 'pla', name: 'PLA', detail: 'Rigid, best detail' },
  { id: 'asa', name: 'ASA', detail: 'Durable, UV stable' },
]

const FINISHES: Record<string, { label: string; hex: string; apiColor: Color }> = {
  black: { label: 'Matte black', hex: '#1a1a1a', apiColor: 'matte_black' },
  tortoise: { label: 'Tortoiseshell', hex: '#7c4a1e', apiColor: 'tortoiseshell' },
  crystal: { label: 'Crystal', hex: '#d4d4d4', apiColor: 'crystal' },
  navy: { label: 'Navy', hex: '#1e3a5f', apiColor: 'navy' },
  bone: { label: 'Bone', hex: '#e8d8c0', apiColor: 'bone' },
  olive: { label: 'Olive', hex: '#6b7c3b', apiColor: 'olive' },
}

const EMPTY_ADDRESS: ShippingAddress = { name: '', line1: '', line2: '', city: '', region: '', postal_code: '', country: '' }

function Field({ label, value, onChange, placeholder, autoComplete, optional = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; autoComplete?: string; optional?: boolean
}) {
  return <label className="block">
    <span className="mb-1.5 block text-xs font-medium text-zinc-700">{label}{optional && <span className="text-zinc-400"> · optional</span>}</span>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete}
      className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900" />
  </label>
}

export default function Checkout() {
  const navigate = useNavigate()
  const { state, dispatch } = useSession()
  const c = state.customize
  const m = state.measurements
  const [material, setMaterial] = useState<Material>(c.material)
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_ADDRESS)
  const [quote, setQuote] = useState<{ grams: number; material_cost: number; shipping: number; total: number; currency: string } | null>(null)
  const [quoteError, setQuoteError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const finish = FINISHES[c.color] ?? FINISHES.black
  const volumeMm3 = state.stlHeaders?.volumeMm3 ?? 0

  useEffect(() => {
    if (!volumeMm3) return
    let active = true
    setQuote(null)
    setQuoteError(false)
    getQuote({ volume_mm3: volumeMm3, material })
      .then(result => active && setQuote(result))
      .catch(() => active && setQuoteError(true))
    return () => { active = false }
  }, [material, volumeMm3])

  useEffect(() => {
    if (!state.stlBlob || !state.stlHeaders || !m) navigate('/customize', { replace: true })
  }, [m, navigate, state.stlBlob, state.stlHeaders])

  const addressValid = useMemo(() => (
    [address.name, address.line1, address.city, address.postal_code].every(value => value.trim().length > 0) &&
    /^[a-z]{2}$/i.test(address.country.trim())
  ), [address])
  const canSubmit = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && addressValid && !!quote && !submitting

  function updateAddress(key: keyof ShippingAddress, value: string) {
    setAddress(previous => ({ ...previous, [key]: key === 'country' ? value.toUpperCase() : value }))
  }

  async function handleOrder() {
    if (!state.stlBlob || !state.stlHeaders || !m || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await placeOrder(state.stlBlob, {
        design: {
          left_contour_mm: m.left.contour_mm, right_contour_mm: m.right.contour_mm,
          bridge_mm: c.frameParams.bridgeMm, depth_mm: c.frameParams.depthMm,
          rim_offset_mm: c.frameParams.rimOffsetMm, clip_clearance_mm: c.frameParams.clipClearanceMm,
          pattern: c.pattern, engraving_text: c.engravingText,
        },
        design_signature: state.stlHeaders.designSignature,
        material, color: finish.apiColor, email: email.trim(),
        shipping_address: {
          ...address, name: address.name.trim(), line1: address.line1.trim(), line2: address.line2?.trim() || undefined,
          city: address.city.trim(), region: address.region?.trim() || undefined,
          postal_code: address.postal_code.trim(), country: address.country.trim(),
        },
        // The API currently exposes its test payment provider only.
        payment: { provider: 'fake', token: 'tok_ok' },
      })
      dispatch({ type: 'SET_ORDER', orderId: result.order_id, accessToken: result.access_token })
      navigate(`/order/${result.order_id}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'MESH_INVALID') setError('Frame mesh is invalid — please regenerate the frame and try again.')
      else if (err instanceof ApiClientError && err.code === 'DESIGN_SIGNATURE_INVALID') setError('This design has changed. Regenerate the frame before ordering.')
      else if (err instanceof ApiClientError) setError(err.message)
      else if (err instanceof TypeError) setError('Could not reach the server. Check your connection.')
      else setError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  if (!state.stlBlob || !m) return null

  return <div className="page-container">
    <PageHeader title="Checkout" backTo="/try-on" />
    <StepProgress current={6} />
    <main className="page-content pt-4">
      <section className="mb-6 flex items-center gap-4">
        <div className="h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-zinc-100"><STLThumbnail blob={state.stlBlob} color={finish.hex} /></div>
        <div className="min-w-0"><p className="text-sm font-semibold text-zinc-900">Your custom frame</p><p className="mt-1 text-xs text-zinc-500">{finish.label} · {c.pattern === 'none' ? 'Smooth finish' : c.pattern}</p><p className="text-xs text-zinc-500">Bridge {c.frameParams.bridgeMm.toFixed(1)} mm{c.engravingText ? ` · ${c.engravingText}` : ''}</p></div>
      </section>

      <p className="section-label mb-2">Material</p>
      <div className="mb-6 grid grid-cols-3 gap-2">
        {MATERIALS.map(option => <button key={option.id} type="button" onClick={() => setMaterial(option.id)} className={`rounded-xl border px-3 py-3 text-left transition-colors ${material === option.id ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-900'}`}><span className="block text-sm font-semibold">{option.name}</span><span className={`mt-0.5 block text-[10px] leading-tight ${material === option.id ? 'text-zinc-300' : 'text-zinc-400'}`}>{option.detail}</span></button>)}
      </div>

      <p className="section-label mb-2">Delivery</p>
      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" /></div>
        <div className="col-span-2"><Field label="Full name" value={address.name} onChange={v => updateAddress('name', v)} autoComplete="name" /></div>
        <div className="col-span-2"><Field label="Address" value={address.line1} onChange={v => updateAddress('line1', v)} autoComplete="address-line1" /></div>
        <div className="col-span-2"><Field label="Apartment, suite, etc." value={address.line2 ?? ''} onChange={v => updateAddress('line2', v)} autoComplete="address-line2" optional /></div>
        <Field label="City" value={address.city} onChange={v => updateAddress('city', v)} autoComplete="address-level2" />
        <Field label="Province / state" value={address.region ?? ''} onChange={v => updateAddress('region', v)} autoComplete="address-level1" optional />
        <Field label="Postal code" value={address.postal_code} onChange={v => updateAddress('postal_code', v)} autoComplete="postal-code" />
        <Field label="Country code" value={address.country} onChange={v => updateAddress('country', v)} placeholder="CA" autoComplete="country" />
      </div>

      <p className="section-label mb-2">Total</p>
      <div className="card mb-5 divide-y divide-zinc-100">
        {quote ? <><div className="flex justify-between px-4 py-3 text-sm"><span className="text-zinc-500">Print · {quote.grams.toFixed(1)} g</span><span className="font-medium">${quote.material_cost.toFixed(2)}</span></div><div className="flex justify-between px-4 py-3 text-sm"><span className="text-zinc-500">Shipping</span><span className="font-medium">${quote.shipping.toFixed(2)}</span></div><div className="flex justify-between px-4 py-4"><span className="font-semibold">Total</span><span className="text-lg font-bold">${quote.total.toFixed(2)} {quote.currency}</span></div></> : <div className="px-4 py-4 text-sm text-zinc-400">{quoteError ? 'Price could not be loaded. Check your connection.' : 'Calculating total…'}</div>}
      </div>

      {error && <div className="mb-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" /><p className="text-xs text-red-700">{error}</p></div>}
      <button type="button" onClick={handleOrder} disabled={!canSubmit} className={`mb-8 h-14 w-full rounded-2xl text-base font-semibold transition-all ${canSubmit ? 'bg-zinc-900 text-white active:scale-[0.98]' : 'cursor-not-allowed bg-zinc-100 text-zinc-400'}`}>{submitting ? 'Placing order…' : quote ? `Place order · $${quote.total.toFixed(2)}` : 'Place order'}</button>
    </main>
  </div>
}
