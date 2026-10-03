import { useState } from 'react'
import { CheckCircle2, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'

type Material = 'petg' | 'pla' | 'asa'
type Checkout = 'guest' | 'account'

const MATERIALS: { id: Material; name: string; tagline: string; pricePerG: number }[] = [
  { id: 'petg', name: 'PETG', tagline: 'Flexible · UV resistant · Recommended', pricePerG: 0.08 },
  { id: 'pla', name: 'PLA', tagline: 'Rigid · Biodegradable · Best detail', pricePerG: 0.06 },
  { id: 'asa', name: 'ASA', tagline: 'UV stable · Outdoor use · Durable', pricePerG: 0.10 },
]

const COLORS = [
  { id: 'black', hex: '#1a1a1a', label: 'Matte black' },
  { id: 'tortoise', hex: '#8B4513', label: 'Tortoise' },
  { id: 'clear', hex: '#e8e8e8', label: 'Crystal' },
  { id: 'navy', hex: '#1e3a5f', label: 'Navy' },
  { id: 'bone', hex: '#e8d8c0', label: 'Bone' },
  { id: 'olive', hex: '#6b7c3b', label: 'Olive' },
]

const PRINT_WEIGHT_G = 4.2
const SHIPPING = 4.99

export default function Order() {
  const navigate = useNavigate()
  const [material, setMaterial] = useState<Material>('petg')
  const [color, setColor] = useState('black')
  const [checkout, setCheckout] = useState<Checkout>('guest')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')

  const selectedMat = MATERIALS.find(m => m.id === material)!
  const subtotal = PRINT_WEIGHT_G * selectedMat.pricePerG
  const total = subtotal + SHIPPING

  const canOrder = email.includes('@') && address.length > 5

  return (
    <div className="page-container">
      <PageHeader title="Order" backTo="/export" />
      <StepProgress current={7} />

      <div className="page-content">

        {/* Order summary card */}
        <div className="card p-4 flex items-center gap-4 mb-5">
          {/* Frame preview placeholder */}
          <div className="w-20 h-16 bg-zinc-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg width="56" height="40" viewBox="0 0 200 90" fill="none">
              <ellipse cx="58" cy="45" rx="42" ry="35" stroke="#3f3f46" strokeWidth="4" />
              <ellipse cx="142" cy="45" rx="42" ry="35" stroke="#3f3f46" strokeWidth="4" />
              <line x1="100" y1="38" x2="100" y2="52" stroke="#3f3f46" strokeWidth="4" />
              <line x1="16" y1="45" x2="2" y2="45" stroke="#3f3f46" strokeWidth="4" strokeLinecap="round" />
              <line x1="184" y1="45" x2="198" y2="45" stroke="#3f3f46" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-900">Custom OptiFrame</p>
            <p className="text-xs text-zinc-400 mt-0.5">L 44.2×36.8 mm · R 51.0×38.1 mm</p>
            <p className="text-xs text-zinc-400">Bridge 18 mm · Rim offset 1.5 mm</p>
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
                  {material === mat.id && <CheckCircle2 size={14} className="text-zinc-900" />}
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">{mat.tagline}</p>
              </div>
              <span className="text-sm font-semibold text-zinc-900">
                ${(mat.pricePerG * PRINT_WEIGHT_G).toFixed(2)}
              </span>
            </button>
          ))}
        </div>

        {/* Color */}
        <p className="section-label mb-2">Color</p>
        <div className="card p-4 mb-5">
          <div className="grid grid-cols-6 gap-3 mb-3">
            {COLORS.map(c => (
              <button
                key={c.id}
                onClick={() => setColor(c.id)}
                className="flex flex-col items-center gap-1.5"
              >
                <div
                  className={`w-9 h-9 rounded-full border-2 transition-all ${
                    color === c.id ? 'border-zinc-900 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 text-center">
            {COLORS.find(c => c.id === color)?.label}
          </p>
        </div>

        {/* Pricing */}
        <p className="section-label mb-2">Pricing</p>
        <div className="card divide-y divide-zinc-100 mb-5">
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Print ({PRINT_WEIGHT_G} g × ${selectedMat.pricePerG}/g)</span>
            <span className="text-sm font-semibold text-zinc-900">${subtotal.toFixed(2)}</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Shipping</span>
            <span className="text-sm font-semibold text-zinc-900">${SHIPPING.toFixed(2)}</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm font-bold text-zinc-900">Total</span>
            <span className="text-base font-bold text-zinc-900">${total.toFixed(2)}</span>
          </div>
        </div>

        {/* Checkout type */}
        <p className="section-label mb-2">Checkout as</p>
        <div className="flex gap-2 mb-4">
          {(['guest', 'account'] as Checkout[]).map(type => (
            <button
              key={type}
              onClick={() => setCheckout(type)}
              className={`flex-1 h-10 rounded-xl text-sm font-semibold transition-all ${
                checkout === type ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'
              }`}
            >
              {type === 'guest' ? 'Guest' : 'My account'}
            </button>
          ))}
        </div>

        {/* Guest form */}
        {checkout === 'guest' && (
          <div className="flex flex-col gap-3 mb-5">
            <div>
              <label className="section-label mb-1 block">Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full h-12 px-4 rounded-xl border border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900 transition-colors"
              />
            </div>
            <div>
              <label className="section-label mb-1 block">Shipping address</label>
              <textarea
                placeholder="123 Main St, City, Country"
                value={address}
                onChange={e => setAddress(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900 transition-colors resize-none"
              />
            </div>
          </div>
        )}

        {checkout === 'account' && (
          <div className="card px-4 py-4 flex items-center justify-between mb-5">
            <p className="text-sm text-zinc-500">Sign in to use saved address</p>
            <ChevronRight size={16} className="text-zinc-300" />
          </div>
        )}

        {/* Place order */}
        <button
          disabled={checkout === 'guest' && !canOrder}
          onClick={() => navigate('/order/OPT-20261003-001')}
          className={`w-full h-14 rounded-2xl text-base font-semibold mb-10 transition-all ${
            checkout === 'account' || canOrder
              ? 'bg-zinc-900 text-white active:scale-[0.98]'
              : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
          }`}
        >
          Place order · ${total.toFixed(2)}
        </button>
      </div>
    </div>
  )
}
