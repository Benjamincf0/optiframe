import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { Camera, ScanFace, Wand2, Eye, ShoppingBag } from 'lucide-react'

const STEPS = [
  { icon: Camera, label: 'Capture lenses', desc: 'Photo each lens flat on a plain surface with a reference object for scale.' },
  { icon: ScanFace, label: 'Face scan', desc: 'MediaPipe measures your pupillary distance. Nothing leaves your device.' },
  { icon: Wand2, label: 'Customize', desc: 'Choose a surface pattern, color, and optional name engraving.' },
  { icon: Eye, label: 'AR try-on', desc: 'See the generated frame on your face in real time using three.js + your camera.' },
  { icon: ShoppingBag, label: 'Order', desc: 'Pick a material and we ship a 3D-printed frame to your door.' },
]

const APP_URL = typeof window !== 'undefined' ? window.location.origin : 'https://optiframe.app'

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="page-container">
      {/* Hero */}
      <div className="px-5 pt-12 pb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">OptiFrame</p>
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 leading-tight mb-4">
          Custom frames<br />for recycled<br />lenses.
        </h1>
        <p className="text-base text-zinc-500 leading-relaxed">
          Photograph any lens. Get a 3D-printed frame that fits it exactly — down to the millimetre.
        </p>
      </div>

      <div className="h-px bg-zinc-100 mx-5" />

      {/* Steps */}
      <div className="px-5 py-6">
        <p className="section-label mb-4">How it works</p>
        <div className="flex flex-col gap-0">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            return (
              <div key={step.label} className="flex items-start gap-4 py-2">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-9 h-9 rounded-xl bg-zinc-100 flex items-center justify-center">
                    <Icon size={16} className="text-zinc-600" />
                  </div>
                  {i < STEPS.length - 1 && <div className="w-px h-4 bg-zinc-200 mt-1" />}
                </div>
                <div className="pb-1 pt-1.5">
                  <p className="text-sm font-semibold text-zinc-900">{step.label}</p>
                  <p className="text-sm text-zinc-500 mt-0.5 leading-snug">{step.desc}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="h-px bg-zinc-100 mx-5" />

      {/* QR Code */}
      <div className="px-5 py-6">
        <p className="section-label mb-3">Open on your phone</p>
        <div className="card p-5 flex items-center gap-5">
          <div className="flex-shrink-0 p-2 bg-white rounded-xl border border-zinc-100">
            <QRCodeSVG
              value={APP_URL}
              size={80}
              bgColor="transparent"
              fgColor="#18181b"
              level="M"
            />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 mb-1">Scan to open</p>
            <p className="text-sm text-zinc-500 leading-snug">
              Requires HTTPS for camera access. Best on Chrome (Android) or Safari (iOS).
            </p>
          </div>
        </div>
      </div>

      {/* Humanitarian context */}
      <div className="px-5 pb-8">
        <div className="card px-4 py-4 bg-zinc-50">
          <p className="text-xs font-semibold text-zinc-700 mb-1">Why this exists</p>
          <p className="text-xs text-zinc-500 leading-relaxed">
            In many regions, opticians are inaccessible or unaffordable. Recycled lenses already exist — the missing piece is a frame that fits them exactly. OptiFrame makes that possible for a few dollars of filament.
          </p>
        </div>
      </div>

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
