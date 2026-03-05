import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Row, Col, Badge, Spinner, Alert } from 'react-bootstrap';
import { projectApi, coverageApi } from '../services/api';
import { Project, CoverageReport } from '../types';

const Home: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [latestReports, setLatestReports] = useState<Map<string, CoverageReport>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const projectsRes = await projectApi.getAll();
      const projectList = projectsRes.data.data || [];
      setProjects(projectList);

      // 批量获取所有项目的最新覆盖率（单次请求）
      if (projectList.length > 0) {
        const ids = projectList.map((p: Project) => p.id);
        const reportsRes = await coverageApi.getLatestBatch(ids);
        const reportsMap = new Map<string, CoverageReport>();
        for (const report of (reportsRes.data.data || [])) {
          reportsMap.set(report.projectId, report);
        }
        setLatestReports(reportsMap);
      }
      setError(null);
    } catch (err) {
      setError('Failed to load data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getPlatformBadge = (platform: string) => {
    return platform === 'ios' 
      ? <Badge bg="dark"><i className="fab fa-apple me-1"></i>iOS</Badge>
      : <Badge bg="success"><i className="fab fa-android me-1"></i>Android</Badge>;
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3 text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">Dashboard</h2>
          <p className="text-muted mb-0">代码覆盖率统计概览</p>
        </div>
        <Link to="/projects" className="btn btn-primary">
          <i className="fas fa-plus me-2"></i>新建项目
        </Link>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {/* 统计卡片 */}
      <Row className="mb-4">
        <Col md={3}>
          <Card className="border-0 shadow-sm h-100">
            <Card.Body className="text-center">
              <div className="display-4 text-primary">{projects.length}</div>
              <div className="text-muted">总项目数</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="border-0 shadow-sm h-100">
            <Card.Body className="text-center">
              <div className="display-4 text-success">
                {projects.filter(p => p.platform === 'android').length}
              </div>
              <div className="text-muted">Android 项目</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="border-0 shadow-sm h-100">
            <Card.Body className="text-center">
              <div className="display-4 text-dark">
                {projects.filter(p => p.platform === 'ios').length}
              </div>
              <div className="text-muted">iOS 项目</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="border-0 shadow-sm h-100">
            <Card.Body className="text-center">
              <div className="display-4 text-info">{latestReports.size}</div>
              <div className="text-muted">已有报告</div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* 项目列表 */}
      <h4 className="mb-3">项目列表</h4>
      {projects.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <Card.Body className="text-center py-5">
            <div className="mb-3">📁</div>
            <h5>暂无项目</h5>
            <p className="text-muted">创建第一个项目开始收集代码覆盖率数据</p>
            <Link to="/projects" className="btn btn-primary">
              创建项目
            </Link>
          </Card.Body>
        </Card>
      ) : (
        <Row>
          {projects.map(project => {
            const report = latestReports.get(project.id);
            return (
              <Col md={6} lg={4} key={project.id} className="mb-3">
                <Card className="border-0 shadow-sm h-100 project-card">
                  <Card.Body>
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <h5 className="mb-0">{project.name}</h5>
                      {getPlatformBadge(project.platform)}
                    </div>
                    
                    {project.repositoryUrl && (
                      <p className="text-muted small mb-3 text-truncate">
                        <i className="fab fa-github me-1"></i>
                        {project.repositoryUrl}
                      </p>
                    )}

                    {report ? (
                      <div>
                        <div className="d-flex justify-content-between text-muted small">
                          <span>Commit: {report.commitHash.substring(0, 7)}</span>
                          <span>{new Date(report.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-3">
                        <span className="text-muted">暂无覆盖率数据</span>
                      </div>
                    )}
                  </Card.Body>
                  <Card.Footer className="bg-white border-top-0">
                    <div className="d-flex gap-2">
                      <Link 
                        to={`/projects/${project.id}`} 
                        className="btn btn-outline-primary btn-sm flex-fill"
                      >
                        详情
                      </Link>
                      <Link 
                        to={`/upload?project=${project.id}`} 
                        className="btn btn-primary btn-sm flex-fill"
                      >
                        上传报告
                      </Link>
                    </div>
                  </Card.Footer>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );
};

export default Home;
