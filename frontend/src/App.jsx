import { Route, Routes } from "react-router-dom";
import Header from "./components/Header";
import MatchSelection from "./pages/MatchSelection";
import Score from "./pages/Score";
import Overview from "./pages/Overview";
import Shots from "./pages/Shots";
import Attack from "./pages/Attack";
import Passes from "./pages/Passes";
import Lineups from "./pages/Lineups";
import Compare from "./pages/Compare";
import "./App.css";

function App() {
  return (
    <div className="app">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<MatchSelection />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/matches/:matchId" element={<Score />}>
            <Route index element={<Overview />} />
            <Route path="lineups" element={<Lineups />} />
            <Route path="shots" element={<Shots />} />
            <Route path="attack" element={<Attack />} />
            <Route path="passes" element={<Passes />} />
          </Route>
        </Routes>
      </main>
    </div>
  );
}

export default App;
