import { BrowserRouter, Route, Routes } from 'react-router'
import { MatchRoute } from './routes/MatchRoute'
import { StartScreen } from './routes/StartScreen'

// Declarative rather than a data router: loaders would fetch the match list
// before render, but a GameServer needs dispose() and loaders have no teardown
// hook -- so the match route would keep its effect anyway, leaving two data
// paradigms with the harder half unimproved.
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StartScreen />} />
        <Route path="/:matchId" element={<MatchRoute />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
