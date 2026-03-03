import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Projects from './pages/Projects';
import Reports from './pages/Reports';
import ReportDetail from './pages/ReportDetail';
import Upload from './pages/Upload';
import './App.css';

const App: React.FC = () => {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<Reports />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:projectId" element={<Reports />} />
          <Route path="/report/:id" element={<ReportDetail />} />
          <Route path="/upload" element={<Upload />} />
        </Routes>
      </Layout>
    </Router>
  );
};

export default App;
