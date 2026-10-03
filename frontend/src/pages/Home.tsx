import { useNavigate } from 'react-router-dom'
import { Camera, Scan, Ruler, Box, Package, QrCode } from 'lucide-react'

const STEPS = [
  { icon: Camera, label: 'Capture', description: 'Photo your lenses on a flat surface' },
  { icon: Scan, label: 'Rectify', description: 'We correct perspective & set the scale' },
  { icon: Scan, label: 'Segment', description: 'AI traces the exact lens contour' },
  { icon: Ruler, label: 'Measure', description: 'Width, height & perimeter in mm' },
  { icon: Box, label: 'Design Frame', description: 'Parametric 3D model, built to your lenses' },
  { icon: Package, label: 'Order', description: 'Printed and shipped to your door' },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="page-container">
      {/* Hero */}
      <div className="px-5 pt-12 pb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">
          OptiFrame
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 leading-tight mb-4">
          Custom frames<br />for recycled lenses.
        </h1>
        <p className="text-base text-zinc-500 leading-relaxed">
          Photograph any lens. Get a 3D-printable frame that fits it exactly — down to the millimetre.
        </p>
      </div>

      {/* Divider */}
      <div className="h-px bg-zinc-100 mx-5" />

      {/* Steps */}
      <div className="px-5 py-6">
        <p className="section-label mb-4">How it works</p>
        <div className="flex flex-col gap-1">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            return (
              <div key={step.label} className="flex items-start gap-4 py-3">
                <div className="flex flex-col items-center">
                  <div className="w-9 h-9 rounded-xl bg-zinc-100 flex items-center justify-center flex-shrink-0">
                    <Icon size={16} className="text-zinc-600" />
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="w-px h-4 bg-zinc-200 mt-1" />
                  )}
                </div>
                <div className="pb-1">
                  <p className="text-sm font-semibold text-zinc-900">{step.label}</p>
                  <p className="text-sm text-zinc-500 mt-0.5">{step.description}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-zinc-100 mx-5" />

      {/* QR Code */}
      <div className="px-5 py-6">
        <p className="section-label mb-4">Open on your phone</p>
        <div className="card p-5 flex items-center gap-5">
          <div className="w-20 h-20 bg-zinc-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <QrCode size={40} className="text-zinc-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 mb-1">Scan to open</p>
            <p className="text-sm text-zinc-500">
              Camera access requires HTTPS. Scan the QR code to open OptiFrame on your phone.
            </p>
          </div>
        </div>
      </div>

      {/* Bottom padding for CTA */}
      <div className="pb-28" />

      {/* CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-zinc-100 px-5 py-4 pb-8">
        <button
          onClick={() => navigate('/capture')}
          className="w-full h-14 rounded-2xl bg-zinc-900 text-white text-base font-semibold active:scale-[0.98] transition-all"
        >
          Get started
        </button>
      </div>
    </div>
  )
}
