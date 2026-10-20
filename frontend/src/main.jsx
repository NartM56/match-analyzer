import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/organic.css'
import './styles/theme.css'
// app theme: Charcoal + Matchday Orange with Barlow fonts (theme-midnight.css is the alternative;
// remove this line for Navy & Brick)
import './styles/theme-charcoal.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
