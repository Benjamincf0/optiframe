import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, X, RotateCcw, Package } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useSession } from '../context/SessionContext'
import { getOrder, cancelOrder, ApiClientError } from '../api/client'
import type { OrderDetail, OrderStatus as OrderStatusType } from '../api/types'

const STEPS: { id: OrderStatusType; label: string; desc: string }[] = [
  { id: 'received', label: 'Received', desc: 'We got your order and STL file.' },
  { id: 'printing', label: 'Printing', desc: 'Your frame is being printed.' },
  { id: 'shipped', label: 'Shipped', desc: 'On its way to you.' },
  { id: 'delivered', label: 'Delivered', desc: 'Enjoy your frames.' },
]

export default function OrderStatus() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { state } = useSession()

  const token = searchParams.get('t') ?? state.orderAccessToken ?? undefined
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const data = await getOrder(id!, token)
        setOrder(data)
      } catch (err) {
        if (err instanceof ApiClientError) {
          setError(err.message)
        } else {
          setError('Could not load order status. Check your connection.')
        }
      } finally {
        setLoading(false)
      }
    }
    load()

    // Poll every 30s
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [id, token]) // eslint-disable-line

  async function handleCancel() {
    if (!id) return
    setCancelling(true)
    try {
      await cancelOrder(id, token)
      setOrder(prev => prev ? { ...prev, status: 'cancelled' } : prev)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not cancel order.')
    } finally {
      setCancelling(false)
    }
  }

  function downloadSTL() {
    if (!state.stlBlob) return
    const url = URL.createObjectURL(state.stlBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'monture.stl'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="page-container">
        <PageHeader title="Order status" backTo="/" />
        <main className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-10 h-10 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
          <p className="text-sm text-zinc-500">Loading order…</p>
        </main>
      </div>
    )
  }

  if (error && !order) {
    return (
      <div className="page-container">
        <PageHeader title="Order status" backTo="/" />
        <main className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-5">
          <Package size={36} className="text-zinc-400" />
          <p className="text-base font-semibold text-zinc-900">Order not found</p>
          <p className="text-sm text-zinc-500">{error}</p>
          <p className="text-sm text-zinc-400 font-mono">{id}</p>
          <button
            onClick={() => navigate('/')}
            className="h-12 px-8 rounded-2xl bg-zinc-900 text-white text-sm font-semibold"
          >
            Go home
          </button>
        </main>
      </div>
    )
  }

  const status = order?.status ?? 'received'
  const currentIdx = STEPS.findIndex(s => s.id === status)
  const isCancelled = status === 'cancelled'

  return (
    <div className="page-container">
      <PageHeader title="Order status" backTo="/" />
      <div className="px-5 pt-4 pb-2 flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1">Order</p>
          <p className="text-2xl font-bold font-mono text-zinc-900">{id}</p>
          <p className="text-xs text-zinc-400 mt-1">Confirmation sent to {order?.email ?? 'your email'}</p>
        </div>
        <div className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
          isCancelled ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-600'
        }`}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </div>
      </div>

      <div className="page-content pt-4">
        {/* Frame thumbnail */}
        <div className="card p-4 flex items-center gap-4 mb-6">
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
            {order && (
              <>
                <p className="text-xs text-zinc-400 mt-0.5">
                  L {order.specs.left_lens.A.toFixed(1)}×{order.specs.left_lens.B.toFixed(1)} · R {order.specs.right_lens.A.toFixed(1)}×{order.specs.right_lens.B.toFixed(1)} mm
                </p>
                <p className="text-xs text-zinc-400">
                  {order.specs.material.toUpperCase()} · Bridge {order.specs.bridge_mm.toFixed(1)} mm
                  {order.specs.engraving_text ? ` · "${order.specs.engraving_text}"` : ''}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Status tracker */}
        <p className="section-label mb-4">Status</p>
        {!isCancelled ? (
          <div className="flex flex-col mb-6">
            {STEPS.map((step, i) => {
              const done = i < currentIdx
              const active = i === currentIdx
              const upcoming = i > currentIdx
              return (
                <div key={step.id} className="flex items-start gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                      done ? 'bg-zinc-900' : active ? 'bg-zinc-900 ring-4 ring-zinc-100' : 'bg-zinc-200'
                    }`}>
                      {done ? (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <div className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-white' : 'bg-zinc-400'}`} />
                      )}
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className={`w-px h-10 mt-0.5 ${done ? 'bg-zinc-900' : 'bg-zinc-200'}`} />
                    )}
                  </div>
                  <div className="pt-1 pb-8">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold ${upcoming ? 'text-zinc-400' : 'text-zinc-900'}`}>
                        {step.label}
                      </p>
                      {active && (
                        <span className="px-2 py-0.5 rounded-full bg-zinc-900 text-white text-[10px] font-semibold">
                          Now
                        </span>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 ${upcoming ? 'text-zinc-300' : 'text-zinc-500'}`}>
                      {step.desc}
                    </p>
                    {step.id === 'shipped' && order?.tracking_number && active && (
                      <p className="text-xs font-mono text-zinc-700 mt-1">
                        Tracking: {order.tracking_number}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-4 py-4 bg-red-50 border border-red-200 rounded-xl mb-6">
            <p className="text-sm font-semibold text-red-800">Order cancelled</p>
            <p className="text-xs text-red-600 mt-1">This order has been cancelled and refunded if applicable.</p>
          </div>
        )}

        {/* Delivery estimate */}
        {order?.estimated_delivery && !isCancelled && (
          <div className="card px-4 py-3.5 flex items-center justify-between mb-5">
            <span className="text-sm text-zinc-500">Estimated delivery</span>
            <span className="text-sm font-semibold text-zinc-900">
              {new Date(order.estimated_delivery.from).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
              {' – '}
              {new Date(order.estimated_delivery.to).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl mb-4">
            <p className="text-xs text-amber-700">{error}</p>
          </div>
        )}

        {/* Actions */}
        {state.stlBlob && (
          <button
            onClick={downloadSTL}
            className="w-full h-12 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-700 flex items-center justify-center gap-2 mb-3 active:bg-zinc-50"
          >
            <Download size={15} />
            Re-download STL
          </button>
        )}

        {status === 'received' && !isCancelled && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="w-full h-12 rounded-xl border border-red-200 text-sm font-medium text-red-600 flex items-center justify-center gap-2 mb-3 active:bg-red-50 disabled:opacity-50"
          >
            <X size={15} />
            {cancelling ? 'Cancelling…' : 'Cancel order'}
          </button>
        )}

        <button
          onClick={() => navigate('/')}
          className="w-full h-12 rounded-xl bg-zinc-900 text-white text-sm font-semibold flex items-center justify-center gap-2 mb-8 active:scale-[0.98] transition-all"
        >
          <RotateCcw size={15} />
          Make another pair
        </button>
      </div>
    </div>
  )
}
