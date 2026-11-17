import '@fontsource-variable/besley'
import '@fontsource/old-standard-tt/400.css'
import '@fontsource/old-standard-tt/400-italic.css'
import '@fontsource/old-standard-tt/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IS_LOCAL } from './config'
import { Mark } from './Indicator'
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
          <Mark />
          Till
        </a>
        <nav>
          <span className="testnet">Testnet</span>
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
            <a className="key" {...linkProps('/')}>
              Back to the start
            </a>
          </div>
        </main>
      )}

      <footer className="bottom">
        <p>
          The register and its dial are redrawn after U.S. Patent 221,360, “Cash Register and Indicator”, J. &amp; J. Ritty,
          Dayton, Ohio, patented 4 November 1879. The patent is in the public domain.
        </p>
        <p>Till runs on testnets: Reactive Lasna, Base Sepolia, Unichain Sepolia and Ethereum Sepolia. Built for the Reactive Omni Buildathon.</p>
      </footer>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
