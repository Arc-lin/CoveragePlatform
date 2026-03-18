import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();

  const navItems = [
    { path: '/', label: '首页', icon: 'bi-house-door' },
    { path: '/projects', label: '项目管理', icon: 'bi-folder2' },
    { path: '/reports', label: '覆盖率报告', icon: 'bi-bar-chart-line' },
    { path: '/upload', label: '上传报告', icon: 'bi-cloud-arrow-up' },
  ];

  const isNavActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    // /report/* 也归入"覆盖率报告"高亮
    if (path === '/reports' && location.pathname.startsWith('/report')) return true;
    return location.pathname.startsWith(path);
  };

  return (
    <div className="d-flex flex-column min-vh-100">
      {/* Header */}
      <nav className="navbar navbar-expand-lg navbar-dark cp-navbar shadow-sm sticky-top">
        <div className="container">
          <Link className="navbar-brand d-flex align-items-center" to="/">
            <i className="bi bi-graph-up-arrow fs-4 me-2"></i>
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
                      isNavActive(item.path) ? 'active' : ''
                    }`}
                    to={item.path}
                  >
                    <i className={`bi ${item.icon} me-1`}></i>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-grow-1" style={{ backgroundColor: 'var(--cp-bg)' }}>
        <div className="container py-4 page-enter">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="cp-footer">
        <div className="container text-center text-muted">
          <small>Code Coverage Platform © 2026 - iOS & Android Coverage Statistics</small>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
