import { Routes, Route, Navigate } from 'react-router-dom'
import { useCaixaStore } from './store/caixaStore'
import { useCarrinhoStore } from './store/carrinhoStore'
import AberturaCaixaPage   from './pages/AberturaCaixaPage'
import TotemInicioPage     from './pages/TotemInicioPage'
import CpfCupomPage        from './pages/CpfCupomPage'
import OperacaoPage        from './pages/OperacaoPage'
import AutorizacaoPage     from './pages/AutorizacaoPage'
import PagamentoPage       from './pages/PagamentoPage'
import ImpressaoCupomPage  from './pages/ImpressaoCupomPage'
import ConsultaVendasPage  from './pages/ConsultaVendasPage'
import FechamentoCaixaPage from './pages/FechamentoCaixaPage'
import PesagemPage         from './pages/PesagemPage'

function Protegida({ children }) {
  const { caixaAberto } = useCaixaStore()
  return caixaAberto ? children : <Navigate to="/" replace />
}

function RootRoute() {
  const { caixaAberto } = useCaixaStore()
  const { itens } = useCarrinhoStore()
  if (caixaAberto && itens.length > 0) return <Navigate to="/operacao" replace />
  if (caixaAberto)                      return <Navigate to="/inicio"   replace />
  return <AberturaCaixaPage />
}

export default function App() {
  return (
    <div className="wrapper">
      <Routes>
        <Route path="/"            element={<RootRoute />} />
        <Route path="/inicio"      element={<Protegida><TotemInicioPage /></Protegida>} />
        <Route path="/cpf"         element={<Protegida><CpfCupomPage /></Protegida>} />
        <Route path="/operacao"    element={<Protegida><OperacaoPage /></Protegida>} />
        <Route path="/autorizacao" element={<Protegida><AutorizacaoPage /></Protegida>} />
        <Route path="/pagamento"   element={<Protegida><PagamentoPage /></Protegida>} />
        <Route path="/impressao"   element={<Protegida><ImpressaoCupomPage /></Protegida>} />
        <Route path="/vendas"      element={<Protegida><ConsultaVendasPage /></Protegida>} />
        <Route path="/fechar"      element={<Protegida><FechamentoCaixaPage /></Protegida>} />
        <Route path="/pesagem"     element={<Protegida><PesagemPage /></Protegida>} />
        <Route path="*"            element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
