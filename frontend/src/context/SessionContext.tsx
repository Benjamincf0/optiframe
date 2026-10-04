import { createContext, useContext, useReducer, type ReactNode } from 'react'
import type { MeasureResponse, Pattern, Material, STLHeaders, ReferenceSpec, LensHint } from '../api/types'

export interface FrameParams {
  bridgeMm: number
  depthMm: number
  rimOffsetMm: number
  clipClearanceMm: number
}

export interface CustomizeState {
  frameParams: FrameParams
  pattern: Pattern
  engravingText: string
  color: string
  material: Material
}

interface SessionState {
  // Step 1: Capture
  leftFile: File | null
  rightFile: File | null
  /** Lens placement zone per photo (null for uploaded files, where the backend searches the whole photo) */
  leftHint: LensHint | null
  rightHint: LensHint | null
  reference: ReferenceSpec

  // Step 2: Measurements (from backend)
  measurements: MeasureResponse | null

  // Step 3: Face scan
  pdMm: number | null
  bridgeFromPd: number | null

  // Step 4: Customization
  customize: CustomizeState

  // Step 5: STL (from backend)
  stlBlob: Blob | null
  stlHeaders: STLHeaders | null

  // Step 6: Order
  orderId: string | null
  orderAccessToken: string | null
}

type Action =
  | {
      type: 'SET_CAPTURES'
      left: File
      right: File
      leftHint: LensHint | null
      rightHint: LensHint | null
      reference: ReferenceSpec
    }
  | { type: 'SET_MEASUREMENTS'; measurements: MeasureResponse }
  | { type: 'SET_PD'; pdMm: number; bridgeMm: number }
  | { type: 'SET_CUSTOMIZE'; customize: Partial<CustomizeState> }
  | { type: 'SET_STL'; blob: Blob; headers: STLHeaders }
  | { type: 'SET_ORDER'; orderId: string; accessToken: string }
  | { type: 'RESET' }

const DEFAULT_CUSTOMIZE: CustomizeState = {
  frameParams: { bridgeMm: 18, depthMm: 5, rimOffsetMm: 1.5, clipClearanceMm: 0.2 },
  pattern: 'none',
  engravingText: '',
  color: 'black',
  material: 'petg',
}

const INITIAL: SessionState = {
  leftFile: null,
  rightFile: null,
  leftHint: null,
  rightHint: null,
  reference: { type: 'credit_card' },
  measurements: null,
  pdMm: null,
  bridgeFromPd: null,
  customize: DEFAULT_CUSTOMIZE,
  stlBlob: null,
  stlHeaders: null,
  orderId: null,
  orderAccessToken: null,
}

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'SET_CAPTURES':
      return {
        ...state,
        leftFile: action.left,
        rightFile: action.right,
        leftHint: action.leftHint,
        rightHint: action.rightHint,
        reference: action.reference,
        measurements: null,
      }
    case 'SET_MEASUREMENTS':
      return { ...state, measurements: action.measurements }
    case 'SET_PD':
      return {
        ...state,
        pdMm: action.pdMm,
        bridgeFromPd: action.bridgeMm,
        customize: {
          ...state.customize,
          frameParams: { ...state.customize.frameParams, bridgeMm: action.bridgeMm },
        },
      }
    case 'SET_CUSTOMIZE':
      return { ...state, customize: { ...state.customize, ...action.customize } }
    case 'SET_STL':
      return { ...state, stlBlob: action.blob, stlHeaders: action.headers }
    case 'SET_ORDER':
      return { ...state, orderId: action.orderId, orderAccessToken: action.accessToken }
    case 'RESET':
      return INITIAL
    default:
      return state
  }
}

interface SessionContextValue {
  state: SessionState
  dispatch: React.Dispatch<Action>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  return <SessionContext.Provider value={{ state, dispatch }}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
