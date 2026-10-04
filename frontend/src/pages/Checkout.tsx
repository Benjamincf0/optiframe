import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import { useSession } from '../context/SessionContext'
import { placeOrder, ApiClientError } from '../api/client'
import type { Material } from '../api/types'

const MATERIALS: { id: Material; name: string; tagline: string; pricePerG: number }[] = [
  { id: 'petg', name: 'PETG', tagline: 'Flexible · UV resistant · Recommended', pricePerG: 0.08 },
  { id: 'pla', name: 'PLA', tagline: 'Rigid · Biodegradable · Best detail', pricePerG: 0.06 },
  { id: 'asa', name: 'ASA', tagline: 'UV stable · Outdoor use · Durable', pricePerG: 0.10 },
]

const COLORS = [
  { id: 'black', label: 'Matte black', hex: '#1a1a1a' },
  { id: 'tortoise', label: 'Tortoise', hex: '#7c4a1e' },
  { id: 'crystal', label: 'Crystal', hex: '#d4d4d4' },
  { id: 'navy', label: 'Navy', hex: '#1e3a5f' },
  { id: 'bone', label: 'Bone', hex: '#e8d8c0' },
  { id: 'olive', label: 'Olive', hex: '#6b7c3b' },
]

const SHIPPING = 4.99
const DENSITY_PETG = 1.24 // g/cm³

export default function Checkout() {
  const navigate = useNavigate()
  const { state, dispatch } = useSession()
  const c = state.customize
  const m = state.measurements

  const [material, setMaterial] = useState<Material>(c.material)
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const volumeCm3 = state.stlHeaders ? state.stlHeaders.volumeMm3 / 1000 : 4.2
  const weightG = volumeCm3 * DENSITY_PETG
  const selectedMat = MATERIALS.find(mat => mat.id === material)!
  const subtotal = weightG * selectedMat.pricePerG
  const total = subtotal + SHIPPING

  const canSubmit = email.includes('@') && address.trim().length > 5 && !submitting

  async function handleOrder() {
    if (!state.stlBlob || !state.stlHeaders) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await placeOrder(state.stlBlob, {
        design_signature: state.stlHeaders.designSignature,
        material,
        color: c.color,
        email,
        shipping_address: address,
      })
      dispatch({ type: 'SET_ORDER', orderId: result.order_id, accessToken: result.access_token })
      navigate(`/order/${result.order_id}`)
    } catch (err) {
      let msg = 'Something went wrong. Please try again.'
      if (err instanceof ApiClientError) {
        if (err.code === 'MESH_INVALID') {
          msg = 'Frame mesh is invalid — please regenerate the frame and try again.'
        } else {
          msg = err.message
        }
      } else if (err instanceof TypeError) {
        msg = 'Could not reach the server. Check your connection.'
      }
      setError(msg)
      setSubmitting(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader title="Checkout" backTo="/try-on" />
      <StepProgress current={6} />

      <div className="page-content">
        {/* Order summary */}
        <div className="card p-4 flex items-center gap-4 mb-5">
          <div className="w-20 h-16 bg-zinc-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg width="52" height="36" viewBox="0 0 200 90" fill="none">
              <ellipse cx="58" cy="45" rx="42" ry="35" stroke="#1a1a1a" strokeWidth="5" />
              <ellipse cx="142" cy="45" rx="42" ry="35" stroke="#1a1a1a" strokeWidth="5" />
              <line x1="100" y1="38" x2="100" y2="52" stroke="#1a1a1a" strokeWidth="5" />
              <line x1="16" y1="45" x2="2" y2="45" stroke="#1a1a1a" strokeWidth="5" strokeLinecap="round" />
              <line x1="184" y1="45" x2="198" y2="45" stroke="#1a1a1a" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-900">Custom OptiFrame</p>
            {m && (
              <p className="text-xs text-zinc-400 mt-0.5">
                L {m.left.A.toFixed(1)}×{m.left.B.toFixed(1)} · R {m.right.A.toFixed(1)}×{m.right.B.toFixed(1)} mm
              </p>
            )}
            <p className="text-xs text-zinc-400">
              Bridge {c.frameParams.bridgeMm.toFixed(1)} mm
              {c.engravingText ? ` · Engraved "${c.engravingText}"` : ''}
            </p>
            <p className="text-xs text-zinc-400">
              Pattern: {c.pattern}
            </p>
          </div>
        </div>

        {/* Material */}
        <p className="section-label mb-2">Material</p>
        <div className="flex flex-col gap-2 mb-5">
          {MATERIALS.map(mat => (
            <button
              key={mat.id}
              onClick={() => setMaterial(mat.id)}
              className={`card px-4 py-3.5 flex items-center justify-between transition-all ${
                material === mat.id ? 'border-zinc-900' : ''
              }`}
            >
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-zinc-900">{mat.name}</p>
                  {material === mat.id && <div className="w-1.5 h-1.5 rounded-full bg-zinc-900" />}
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">{mat.tagline}</p>
              </div>
              <span className="text-sm font-semibold text-zinc-900">${(mat.pricePerG * weightG).toFixed(2)}</span>
            </button>
          ))}
        </div>

        {/* Color confirmation */}
        <p className="section-label mb-2">Filament color</p>
        <div className="card px-4 py-3.5 flex items-center gap-3 mb-5">
          <div
            className="w-8 h-8 rounded-full border border-zinc-200 flex-shrink-0"
            style={{ backgroundColor: COLORS.find(col => col.id === c.color)?.hex ?? '#1a1a1a' }}
          />
          <p className="text-sm font-medium text-zinc-900">
            {COLORS.find(col => col.id === c.color)?.label ?? c.color}
          </p>
          <button onClick={() => navigate('/customize')} className="ml-auto text-xs text-zinc-400 underline underline-offset-2">
            Change
          </button>
        </div>

        {/* Pricing */}
        <p className="section-label mb-2">Pricing</p>
        <div className="card divide-y divide-zinc-100 mb-5">
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">
              Print ({weightG.toFixed(1)} g × ${selectedMat.pricePerG.toFixed(2)}/g)
            </span>
            <span className="text-sm font-semibold text-zinc-900">${subtotal.toFixed(2)}</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Shipping</span>
            <span className="text-sm font-semibold text-zinc-900">${SHIPPING.toFixed(2)}</span>
          </div>
          <div className="px-4 py-4 flex items-center justify-between">
            <span className="text-sm font-bold text-zinc-900">Total</span>
            <span className="text-xl font-bold text-zinc-900">${total.toFixed(2)}</span>
          </div>
        </div>

        {/* Contact & delivery */}
        <p className="section-label mb-2">Email</p>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full h-12 px-4 rounded-xl border border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900 transition-colors mb-4"
        />

        <p className="section-label mb-2">Shipping address</p>
        <textarea
          placeholder="123 Main St&#10;City, Country, Postal code"
          value={address}
          onChange={e => setAddress(e.target.value)}
          rows={3}
          className="w-full px-4 py-3 rounded-xl border border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900 transition-colors resize-none mb-5"
        />

        {/* Error */}
        {error && (
          <div className="px-4 py-3.5 bg-red-50 border border-red-200 rounded-xl flex gap-3 mb-4">
            <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleOrder}
          disabled={!canSubmit}
          className={`w-full h-14 rounded-2xl text-base font-semibold transition-all mb-8 ${
            canSubmit
              ? 'bg-zinc-900 text-white active:scale-[0.98]'
              : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
          }`}
        >
          {submitting ? 'Placing order…' : `Place order · $${total.toFixed(2)}`}
        </button>

        <p className="text-xs text-zinc-400 text-center mb-6">
          Your STL is validated before payment is processed.
          Payment powered by our print partner — no card data touches our servers.
        </p>
      </div>
    </div>
  )
}
