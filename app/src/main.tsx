import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IS_LOCAL } from './config'
import { Home } from './pages/Home'
import { InvoicePage } from './pages/InvoicePage'
import { NewInvoice } from './pages/NewInvoice'
import { linkProps, useRoute } from './router'
import './styles.css'

function App() {
  const route = useRoute()
  return (
    <>
      <header className="top">
        <a className="brand" {...linkProps('/')}>
          <span className="brand-mark" aria-hidden="true" />
          Till
        </a>
        <nav>
          <a {...linkProps('/new')}>New invoice</a>
        </nav>
      </header>

      {IS_LOCAL && <p className="banner">Local devnet. Explorer links are hidden because these chains only exist on this machine.</p>}

      {route.page === 'home' && <Home />}
      {route.page === 'new' && <NewInvoice />}
      {route.page === 'invoice' && <InvoicePage key={route.id} id={route.id} />}
      {route.page === 'notFound' && (
        <main className="page narrow">
          <div className="receipt">
            <h1 className="h2">Nothing here</h1>
            <a className="button" {...linkProps('/')}>
              Back to the start
            </a>
          </div>
        </main>
      )}

      <footer className="bottom">
        <p>
          Till runs on testnets: Reactive Lasna, Base Sepolia, Unichain Sepolia and Ethereum Sepolia. Built for the
          Reactive Omni Buildathon.
        </p>
      </footer>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
