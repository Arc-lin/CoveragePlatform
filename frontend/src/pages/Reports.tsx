import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Card, Table, Badge, Button, Spinner, Alert, Form, Row, Col } from 'react-bootstrap';
import { projectApi, coverageApi } from '../services/api';
import { Project, CoverageReport } from '../types';

const Reports: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<CoverageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (projectId) {
      const project = projects.find(p => p.id === parseInt(projectId));
      if (project) {
        setSelectedProject(project);
        loadReports(parseInt(projectId));
      }
    } else if (projects.length > 0) {
      setSelectedProject(projects[0]);
      loadReports(projects[0].id);
    }
  }, [projectId, projects]);

  const loadProjects = async () => {
    try {
      const res = await projectApi.getAll();
      setProjects(res.data.data || []);
    } catch (err) {
      setError('Failed to load projects');
    }
  };

  const loadReports = async (id: number) => {
    try {
      setLoading(true);
      const res = await coverageApi.getByProject(id);
      setReports(res.data.data || []);
      setError(null);
    } catch (err) {
      setError('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = parseInt(e.target.value);
    const project = projects.find(p => p.id === id);
    if (project) {
      setSelectedProject(project);
      loadReports(id);
    }
  };

  const getCoverageColor = (coverage: number) => {
    if (coverage >= 80) return 'success';
    if (coverage >= 60) return 'warning';
    return 'danger';
  };

  const getCoverageBadge = (coverage: number) => {
    const color = getCoverageColor(coverage);
    return <Badge bg={color}>{coverage.toFixed(1)}%</Badge>;
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>覆盖率报告</h2>
        {selectedProject && (
          <Link 
            to={`/upload?project=${selectedProject.id}`} 
            className="btn btn-primary"
          >
            上传新报告
          </Link>
        )}
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}

      <Card className="border-0 shadow-sm mb-4">
        <Card.Body>
          <Form.Group>
            <Form.Label>选择项目</Form.Label>
            <Form.Select 
              value={selectedProject?.id || ''} 
              onChange={handleProjectChange}
            >
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.platform})
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Card.Body>
      </Card>

      {selectedProject && (
        <Card className="border-0 shadow-sm">
          <Card.Header className="bg-white">
            <h5 className="mb-0">
              {selectedProject.name} 
              <Badge bg={selectedProject.platform === 'ios' ? 'dark' : 'success'} className="ms-2">
                {selectedProject.platform}
              </Badge>
            </h5>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <div className="text-center py-5">
                <Spinner animation="border" variant="primary" />
              </div>
            ) : reports.length === 0 ? (
              <div className="text-center py-5">
                <p className="text-muted">暂无覆盖率报告</p>
                <Link 
                  to={`/upload?project=${selectedProject.id}`}
                  className="btn btn-primary"
                >
                  上传第一份报告
                </Link>
              </div>
            ) : (
              <Table hover responsive>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>Commit</th>
                    <th>分支</th>
                    <th>行覆盖率</th>
                    <th>函数覆盖率</th>
                    <th>分支覆盖率</th>
                    <th>增量覆盖率</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map(report => (
                    <tr key={report.id} style={{ cursor: 'pointer' }}>
                      <td onClick={() => navigate(`/report/${report.id}`)}>
                        {new Date(report.createdAt).toLocaleString()}
                      </td>
                      <td onClick={() => navigate(`/report/${report.id}`)}>
                        <code>{report.commitHash.substring(0, 7)}</code>
                      </td>
                      <td onClick={() => navigate(`/report/${report.id}`)}>
                        <Badge bg="secondary">{report.branch}</Badge>
                      </td>
                      <td onClick={() => navigate(`/report/${report.id}`)}>
                        {getCoverageBadge(report.lineCoverage)}
                      </td>
                      <td onClick={() => navigate(`/report/${report.id}`)}>
                        {getCoverageBadge(report.functionCoverage)}
                      </td>
                      <td onClick={() => navigate(`/report/${report.id}`)}>
                        {getCoverageBadge(report.branchCoverage)}
                      </td>
                      <td onClick={() => navigate(`/report/${report.id}`)}>
                        {report.incrementalCoverage !== undefined ? (
                          getCoverageBadge(report.incrementalCoverage)
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        <Button 
                          variant="outline-primary" 
                          size="sm"
                          onClick={() => navigate(`/report/${report.id}`)}
                        >
                          View Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card.Body>
        </Card>
      )}

      {/* 统计概览 */}
      {!loading && reports.length > 0 && (
        <Row className="mt-4">
          <Col md={4}>
            <Card className="border-0 shadow-sm text-center">
              <Card.Body>
                <h3 className="text-primary">{reports.length}</h3>
                <p className="text-muted mb-0">总报告数</p>
              </Card.Body>
            </Card>
          </Col>
          <Col md={4}>
            <Card className="border-0 shadow-sm text-center">
              <Card.Body>
                <h3 className="text-success">
                  {reports[0].lineCoverage.toFixed(1)}%
                </h3>
                <p className="text-muted mb-0">最新行覆盖率</p>
              </Card.Body>
            </Card>
          </Col>
          <Col md={4}>
            <Card className="border-0 shadow-sm text-center">
              <Card.Body>
                <h3 className="text-info">
                  {new Set(reports.map(r => r.branch)).size}
                </h3>
                <p className="text-muted mb-0">分支数</p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default Reports;
