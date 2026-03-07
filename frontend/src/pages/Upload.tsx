import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, Form, Button, Alert, ProgressBar, Spinner } from 'react-bootstrap';
import { projectApi, uploadApi } from '../services/api';
import { Project } from '../types';

const Upload: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const preselectedProject = searchParams.get('project');

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    projectId: preselectedProject || '',
    commitHash: '',
    branch: 'main',
    platform: 'android' as 'ios' | 'android' | 'python',
    file: null as File | null
  });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const res = await projectApi.getAll();
      const projectList = res.data.data || [];
      setProjects(projectList);
      
      // 如果有预选项目，设置平台
      if (preselectedProject) {
        const project = projectList.find((p: Project) => p.id === preselectedProject);
        if (project) {
          setFormData(prev => ({ ...prev, platform: project.platform }));
        }
      }
    } catch (err) {
      setError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFormData({ ...formData, file: e.target.files[0] });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.file) {
      setError('请选择覆盖率文件');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);
    setSuccess(null);

    try {
      const data = new FormData();
      data.append('file', formData.file);
      data.append('projectId', formData.projectId);
      data.append('commitHash', formData.commitHash);
      data.append('branch', formData.branch);
      data.append('platform', formData.platform);

      const res = await uploadApi.uploadCoverage(data, (progressEvent) => {
        const percent = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
        setUploadProgress(percent);
      });
      
      if (res.data.success) {
        setSuccess(`上传成功！报告ID: ${res.data.data?.reportId || 'unknown'}`);
        setFormData({
          projectId: preselectedProject || '',
          commitHash: '',
          branch: 'main',
          platform: 'android',
          file: null
        });
        // 重置文件输入
        const fileInput = document.getElementById('coverageFile') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      } else {
        setError(res.data.message || '上传失败');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || '上传失败，请检查网络连接');
    } finally {
      setUploading(false);
    }
  };

  const getAcceptedFileTypes = () => {
    if (formData.platform === 'android') return '.ec,.exec,.xml,.info';
    if (formData.platform === 'python') return '.xml,.info,.json';
    return '.profraw,.profdata,.info';
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>上传覆盖率报告</h2>
        <Button variant="outline-secondary" onClick={() => navigate(-1)}>
          返回
        </Button>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert variant="success" dismissible onClose={() => setSuccess(null)}>{success}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body>
          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" variant="primary" />
            </div>
          ) : projects.length === 0 ? (
            <Alert variant="warning">
              暂无项目，请先<Alert.Link href="/projects">创建项目</Alert.Link>
            </Alert>
          ) : (
            <Form onSubmit={handleSubmit}>
              <Form.Group className="mb-3">
                <Form.Label>选择项目</Form.Label>
                <Form.Select
                  required
                  value={formData.projectId}
                  onChange={e => {
                    const projectId = e.target.value;
                    const project = projects.find(p => p.id === projectId);
                    setFormData({ 
                      ...formData, 
                      projectId,
                      platform: project?.platform || 'android'
                    });
                  }}
                  disabled={!!preselectedProject}
                >
                  <option value="">请选择项目</option>
                  {projects.map(project => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.platform})
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>平台</Form.Label>
                <Form.Select
                  value={formData.platform}
                  onChange={e => setFormData({ ...formData, platform: e.target.value as 'ios' | 'android' | 'python' })}
                  disabled
                >
                  <option value="android">Android</option>
                  <option value="ios">iOS</option>
                  <option value="python">Python</option>
                </Form.Select>
                <Form.Text className="text-muted">
                  平台由所选项目决定
                </Form.Text>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Commit Hash</Form.Label>
                <Form.Control
                  type="text"
                  required
                  value={formData.commitHash}
                  onChange={e => setFormData({ ...formData, commitHash: e.target.value })}
                  placeholder="例如: abc1234"
                />
                <Form.Text className="text-muted">
                  Git commit hash，用于关联代码版本
                </Form.Text>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>分支</Form.Label>
                <Form.Control
                  type="text"
                  required
                  value={formData.branch}
                  onChange={e => setFormData({ ...formData, branch: e.target.value })}
                  placeholder="例如: main, develop"
                />
              </Form.Group>

              <Form.Group className="mb-4">
                <Form.Label>覆盖率文件</Form.Label>
                <Form.Control
                  id="coverageFile"
                  type="file"
                  required
                  accept={getAcceptedFileTypes()}
                  onChange={handleFileChange}
                />
                <Form.Text className="text-muted">
                  {formData.platform === 'android'
                    ? '支持格式: .ec, .exec, .xml, .info (JaCoCo 报告)'
                    : formData.platform === 'python'
                      ? '支持格式: .xml (Cobertura), .info (LCOV), .json (coverage.py JSON)'
                      : '支持格式: .profraw, .profdata, .info (LLVM Coverage 报告)'}
                </Form.Text>
              </Form.Group>

              {uploading && (
                <div className="mb-3">
                  <ProgressBar 
                    animated 
                    now={uploadProgress} 
                    label={`${uploadProgress}%`}
                  />
                </div>
              )}

              <div className="d-flex gap-2">
                <Button 
                  variant="primary" 
                  type="submit" 
                  disabled={uploading}
                  className="flex-fill"
                >
                  {uploading ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      上传中...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-upload me-2"></i>上传报告
                    </>
                  )}
                </Button>
              </div>
            </Form>
          )}
        </Card.Body>
      </Card>

      {/* 使用说明 */}
      <Card className="border-0 shadow-sm mt-4">
        <Card.Header className="bg-light">
          <h5 className="mb-0">📖 使用说明</h5>
        </Card.Header>
        <Card.Body>
          <h6>Android 项目</h6>
          <ol>
            <li>在 build.gradle 中开启 <code>testCoverageEnabled true</code></li>
            <li>运行测试生成覆盖率数据（.ec 或 .exec 文件）</li>
            <li>或使用 <code>./gradlew jacocoTestReport</code> 生成 XML 报告</li>
          </ol>
          
          <h6>iOS 项目</h6>
          <ol>
            <li>在 Build Settings 中添加编译参数 <code>-fprofile-instr-generate</code></li>
            <li>运行 App 后从 Document 目录获取 .profraw 文件</li>
            <li>或使用 <code>llvm-cov</code> 转换为 .info 文件</li>
          </ol>

          <h6>Python 项目</h6>
          <ol>
            <li>安装 coverage.py: <code>pip install coverage</code></li>
            <li>运行测试: <code>coverage run -m pytest</code></li>
            <li>生成 Cobertura XML: <code>coverage xml -o coverage.xml</code></li>
            <li>或生成 LCOV: <code>coverage lcov -o coverage.info</code></li>
          </ol>
        </Card.Body>
      </Card>
    </div>
  );
};

export default Upload;
