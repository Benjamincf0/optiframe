import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Capture from './pages/Capture'
import Rectify from './pages/Rectify'
import Segment from './pages/Segment'
import Measure from './pages/Measure'
import FrameDesign from './pages/FrameDesign'
import Export from './pages/Export'
import Order from './pages/Order'
import OrderStatus from './pages/OrderStatus'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/capture" element={<Capture />} />
        <Route path="/rectify" element={<Rectify />} />
        <Route path="/segment" element={<Segment />} />
        <Route path="/measure" element={<Measure />} />
        <Route path="/frame" element={<FrameDesign />} />
        <Route path="/export" element={<Export />} />
        <Route path="/order" element={<Order />} />
        <Route path="/order/:id" element={<OrderStatus />} />
      </Routes>
    </BrowserRouter>
  )
}
