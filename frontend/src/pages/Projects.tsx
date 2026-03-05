import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Table, Badge, Button, Spinner, Alert, Modal, Form } from 'react-bootstrap';
import { projectApi } from '../services/api';
import { Project } from '../types';

const Projects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    platform: 'android' as 'ios' | 'android',
    repositoryUrl: ''
  });
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const res = await projectApi.getAll();
      setProjects(res.data.data || []);
      setError(null);
    } catch (err) {
      setError('Failed to load projects');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await projectApi.create(formData);
      setShowModal(false);
      setFormData({ name: '', platform: 'android', repositoryUrl: '' });
      loadProjects();
    } catch (err) {
      setError('Failed to create project');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除这个项目吗？')) return;
    try {
      await projectApi.delete(id);
      loadProjects();
    } catch (err) {
      setError('Failed to delete project');
    }
  };

  const getPlatformBadge = (platform: string) => {
    return platform === 'ios' 
      ? <Badge bg="dark">iOS</Badge>
      : <Badge bg="success">Android</Badge>;
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>项目管理</h2>
        <Button variant="primary" onClick={() => setShowModal(true)}>
          <i className="fas fa-plus me-2"></i>新建项目
        </Button>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body>
          {projects.length === 0 ? (
            <div className="text-center py-5">
              <p className="text-muted">暂无项目</p>
              <Button variant="primary" onClick={() => setShowModal(true)}>
                创建第一个项目
              </Button>
            </div>
          ) : (
            <Table hover responsive>
              <thead>
                <tr>
                  <th>项目名称</th>
                  <th>平台</th>
                  <th>仓库地址</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(project => (
                  <tr key={project.id}>
                    <td>
                      <Link to={`/projects/${project.id}`} className="text-decoration-none fw-bold">
                        {project.name}
                      </Link>
                    </td>
                    <td>{getPlatformBadge(project.platform)}</td>
                    <td className="text-truncate" style={{ maxWidth: '200px' }}>
                      {project.repositoryUrl || '-'}
                    </td>
                    <td>{new Date(project.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="d-flex gap-2">
                        <Button 
                          variant="outline-primary" 
                          size="sm"
                          onClick={() => navigate(`/projects/${project.id}`)}
                        >
                          查看
                        </Button>
                        <Button 
                          variant="outline-success" 
                          size="sm"
                          onClick={() => navigate(`/upload?project=${project.id}`)}
                        >
                          上传
                        </Button>
                        <Button 
                          variant="outline-danger" 
                          size="sm"
                          onClick={() => handleDelete(project.id)}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* 创建项目 Modal */}
      <Modal show={showModal} onHide={() => setShowModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>新建项目</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSubmit}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>项目名称</Form.Label>
              <Form.Control
                type="text"
                required
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="输入项目名称"
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>平台</Form.Label>
              <Form.Select
                value={formData.platform}
                onChange={e => setFormData({ ...formData, platform: e.target.value as 'ios' | 'android' })}
              >
                <option value="android">Android</option>
                <option value="ios">iOS</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>仓库地址</Form.Label>
              <Form.Control
                type="url"
                required
                value={formData.repositoryUrl}
                onChange={e => setFormData({ ...formData, repositoryUrl: e.target.value })}
                placeholder="https://github.com/..."
              />
              <Form.Text className="text-muted">
                用于获取源码展示覆盖率详情，目前仅支持 GitHub 仓库
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit">
              创建
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  );
};

export default Projects;
