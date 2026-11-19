import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import ScannerPage from './pages/ScannerPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import './styles.css';

function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <span className="brand">Price Checker</span>
        <nav>
          <NavLink to="/" end>Scanner</NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<ScannerPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
