import { HashRouter, Routes, Route } from 'react-router-dom'
import { NetworkProvider } from './context/NetworkContext'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import PackagePage from './pages/PackagePage'
import './styles/global.css'

function App() {
  return (
    <NetworkProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/package/*" element={<PackagePage />} />
        </Routes>
      </HashRouter>
    </NetworkProvider>
  )
}

export default App
