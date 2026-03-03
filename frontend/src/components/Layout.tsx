import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();

  const navItems = [
    { path: '/', label: '首页', icon: '🏠' },
    { path: '/projects', label: '项目管理', icon: '📁' },
    { path: '/reports', label: '覆盖率报告', icon: '📊' },
    { path: '/upload', label: '上传报告', icon: '⬆️' },
  ];

  return (
    <div className="d-flex flex-column min-vh-100">
      {/* Header */}
      <nav className="navbar navbar-expand-lg navbar-dark bg-primary shadow-sm">
        <div className="container">
          <Link className="navbar-brand d-flex align-items-center" to="/">
            <span className="fs-4 me-2">📈</span>
            <span className="fw-bold">Code Coverage Platform</span>
          </Link>
          <button 
            className="navbar-toggler" 
            type="button" 
            data-bs-toggle="collapse" 
            data-bs-target="#navbarNav"
          >
            <span className="navbar-toggler-icon"></span>
          </button>
          <div className="collapse navbar-collapse" id="navbarNav">
            <ul className="navbar-nav ms-auto">
              {navItems.map(item => (
                <li key={item.path} className="nav-item">
                  <Link 
                    className={`nav-link d-flex align-items-center ${
                      location.pathname === item.path ? 'active' : ''
                    }`}
                    to={item.path}
                  >
                    <span className="me-1">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-grow-1 bg-light">
        <div className="container py-4">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-top py-3">
        <div className="container text-center text-muted">
          <small>Code Coverage Platform © 2026 - iOS & Android Coverage Statistics</small>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
