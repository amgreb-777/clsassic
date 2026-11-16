import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { UIProvider } from './components/ui'
// Шрифти розміщені разом із сайтом (без запитів до Google): кирилиця + латиниця
import '@fontsource/jost/cyrillic-400.css'
import '@fontsource/jost/cyrillic-500.css'
import '@fontsource/jost/cyrillic-600.css'
import '@fontsource/jost/latin-400.css'
import '@fontsource/jost/latin-500.css'
import '@fontsource/jost/latin-600.css'
import '@fontsource/inter/cyrillic-400.css'
import '@fontsource/inter/cyrillic-500.css'
import '@fontsource/inter/cyrillic-600.css'
import '@fontsource/inter/cyrillic-700.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/marck-script/cyrillic-400.css'
import '@fontsource/marck-script/latin-400.css'
import './index.css'

// Застосовуємо збережену тему до першого рендера (без «блимання»)
try {
  const t = localStorage.getItem('theme')
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
} catch {
  /* немає доступу до localStorage */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <UIProvider>
        <App />
      </UIProvider>
    </HashRouter>
  </StrictMode>,
)
