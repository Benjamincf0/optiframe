import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { SessionProvider } from './context/SessionContext'
import Home from './pages/Home'
import Capture from './pages/Capture'
import Processing from './pages/Processing'
import Measurements from './pages/Measurements'
import FaceScan from './pages/FaceScan'
import Customize from './pages/Customize'
import Generating from './pages/Generating'
import TryOn from './pages/TryOn'
import Checkout from './pages/Checkout'
import OrderStatus from './pages/OrderStatus'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/processing" element={<Processing />} />
          <Route path="/measurements" element={<Measurements />} />
          <Route path="/face-scan" element={<FaceScan />} />
          <Route path="/customize" element={<Customize />} />
          <Route path="/generating" element={<Generating />} />
          <Route path="/try-on" element={<TryOn />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order/:id" element={<OrderStatus />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
