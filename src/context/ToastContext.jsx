import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ToastContext = createContext(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

let toastIdCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((type, message, duration = 5000) => {
    const id = ++toastIdCounter
    setToasts(prev => [...prev, { id, type, message, duration }])
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration)
    }
    return id
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return
    const handleToast = (data) => {
      addToast(data.type || 'info', data.message, data.duration)
    }
    window.electronAPI.onToast(handleToast)
    return () => { window.electronAPI.removeToastListeners() }
  }, [addToast])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

function ToastContainer({ toasts, onRemove }) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onRemove={() => onRemove(toast.id)} />
      ))}
    </div>
  )
}

function Toast({ toast, onRemove }) {
  const bg = {
    success: 'bg-green-600/85',
    error: 'bg-red-600/85',
    warning: 'bg-yellow-500/90 text-gray-900',
    info: 'bg-gray-700/85',
  }[toast.type] || 'bg-gray-700/85'

  const icon = {
    success: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }[toast.type]

  return (
    <div
      className={`${bg} text-white relative px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 pointer-events-auto overflow-hidden`}
      style={{ animation: 'popIn 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
    >
      <span className="absolute left-0 bottom-0 h-[2px] bg-white/40 origin-left" style={{ animation: 'toastTimer linear forwards', animationDuration: `${Math.max(toast.duration || 5000, 1000)}ms` }} />
      {icon}
      <p className="text-sm flex-1">{toast.message}</p>
      <button onClick={onRemove} className="text-white/70 hover:text-white shrink-0 transition-colors hover:scale-110">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}