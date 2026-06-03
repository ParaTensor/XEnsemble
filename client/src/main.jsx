import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  // React.StrictMode causes double render, which can mess with terminal initialization in dev.
  // Using fragments or div instead.
  <App />
)
