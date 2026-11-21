import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import ScannerPage from './pages/ScannerPage.jsx';
import ProductsPage from './pages/ProductsPage.jsx';
import Login from './components/Login.jsx';
import { AuthProvider, useAuth } from './auth.jsx';
import './styles.css';

function App() {
  const { user, signOut } = useAuth();

  return (
    <BrowserRouter>
      <header className="topbar">
        <span className="brand">Price Checker</span>
        {user && (
          <nav>
            <NavLink to="/" end>Scanner</NavLink>
            <NavLink to="/products">My Prices</NavLink>
          </nav>
        )}
        {user && (
          <div className="account">
            <span className="store-name" title={`Signed in as ${user.username}`}>
              {user.storeName}
              {user.isAdmin && <span className="tag">admin</span>}
            </span>
            <button className="secondary small" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </header>
      <main>
        {user === undefined ? (
          <p className="muted center">Loading…</p>
        ) : !user ? (
          <Login />
        ) : (
          <Routes>
            <Route path="/" element={<ScannerPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/admin" element={<Navigate to="/products" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
