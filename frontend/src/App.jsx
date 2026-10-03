import { Route, Routes } from "react-router-dom";
import Header from "./components/Header";
import MatchSelection from "./pages/MatchSelection";
import "./App.css";

function App() {
  return (
    <div className="app">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<MatchSelection />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
