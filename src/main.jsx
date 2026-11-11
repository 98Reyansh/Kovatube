import React from 'react'
import ReactDOM from 'react-dom/client'
import { installBridge } from './lib/bridge'
import App from './App.jsx'
import './index.css'

installBridge()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)