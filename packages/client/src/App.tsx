import { BrowserRouter, Route, Routes } from 'react-router';
import { MapViewer } from './routes/MapViewer';
import { MatchRoute } from './routes/MatchRoute';
import { StartScreen } from './routes/StartScreen';

// Declarative rather than a data router: loaders would fetch the match list
// before render, but a GameServer needs dispose() and loaders have no teardown
// hook -- so the match route would keep its effect anyway, leaving two data
// paradigms with the harder half unimproved.
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StartScreen />} />
        {/* ⚠️ Before `/:matchId` for the reader's sake only -- react-router
            ranks a static segment above a dynamic one whatever the order, so a
            match whose id is literally "maps" is unreachable either way. Ids
            are uuids, so that is a curiosity rather than a bug. */}
        <Route path="/maps" element={<MapViewer />} />
        <Route path="/:matchId" element={<MatchRoute />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
