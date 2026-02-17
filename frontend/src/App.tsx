import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { NetworkProvider } from './context/NetworkContext'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import PackagePage from './pages/PackagePage'
import './styles/global.css'

function App() {
  return (
    <NetworkProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/package/*" element={<PackagePage />} />
        </Routes>
      </BrowserRouter>
    </NetworkProvider>
  )
}

export default App
