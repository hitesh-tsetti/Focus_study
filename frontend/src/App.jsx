import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import CreateSession from "./pages/CreateSession";
import Calibrate from "./pages/Calibrate";
import ActiveSession from "./pages/ActiveSession";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import "./index.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateSession />} />
        <Route path="/calibrate" element={<Calibrate />} />
        <Route path="/session" element={<ActiveSession />} />
        <Route path="/dashboard/:sessionId" element={<Dashboard />} />
        <Route path="/history" element={<History />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
