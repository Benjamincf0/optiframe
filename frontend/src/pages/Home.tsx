import { useNavigate } from 'react-router-dom'
import { Camera, ScanFace, Wand2, Eye, ShoppingBag } from 'lucide-react'
import PageHeader from '../components/PageHeader'

const STEPS = [
  { icon: Camera, label: 'Capture lenses', desc: 'Photo each lens flat on a plain surface with a reference object for scale.' },
  { icon: ScanFace, label: 'Face scan', desc: 'MediaPipe measures your pupillary distance. Nothing leaves your device.' },
  { icon: Wand2, label: 'Customize', desc: 'Choose a surface pattern, color, and optional name engraving.' },
  { icon: Eye, label: 'AR try-on', desc: 'See the generated frame on your face in real time using three.js + your camera.' },
  { icon: ShoppingBag, label: 'Order', desc: 'Pick a material and we ship a 3D-printed frame to your door.' },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="page-container">
      <PageHeader title="OptiFrame" />
      {/* Hero */}
      <div className="px-5 pt-8 pb-8">
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
