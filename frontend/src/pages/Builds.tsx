import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Card, Table, Badge, Button, Spinner, Alert, Modal, Form, ProgressBar } from 'react-bootstrap';
import { projectApi, buildApi } from '../services/api';
import { Project, Build, RawUpload } from '../types';

const Builds: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Build modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ commitHash: '', branch: '', buildVersion: '', gitDiff: '' });
  const [binaryFile, setBinaryFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Pgyer download
  const [binarySource, setBinarySource] = useState<'file' | 'pgyer'>('file');
  const [pgyerUrl, setPgyerUrl] = useState('');
  const [pgyerStatus, setPgyerStatus] = useState('');
  const [pgyerDownloadProgress, setPgyerDownloadProgress] = useState(0);

  // Raw uploads modal
  const [showRawUploadsModal, setShowRawUploadsModal] = useState(false);
  const [rawUploads, setRawUploads] = useState<RawUpload[]>([]);
  const [rawUploadsLoading, setRawUploadsLoading] = useState(false);
  const [selectedBuild, setSelectedBuild] = useState<Build | null>(null);

  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [buildToDelete, setBuildToDelete] = useState<Build | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (projectId) {
      loadData();
    }
  }, [projectId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [projectRes, buildsRes] = await Promise.all([
        projectApi.getById(projectId!),
        buildApi.getByProject(projectId!)
      ]);
      setProject(projectRes.data.data);
      setBuilds(buildsRes.data.data || []);
      setError(null);
    } catch (err) {
      setError('Failed to load data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBuild = async () => {
    if (binarySource === 'file') {
      if (!binaryFile || !createForm.commitHash || !createForm.branch) {
        setError('Please fill in all required fields and select a binary file');
        return;
      }
    } else {
      if (!pgyerUrl || !createForm.commitHash || !createForm.branch) {
        setError('Please fill in all required fields and provide a Pgyer URL');
        return;
      }
    }

    try {
      setCreating(true);

      if (binarySource === 'file') {
        // === 原有的文件上传流程 ===
        setUploadProgress(0);
        const formData = new FormData();
        formData.append('binary', binaryFile!);
        formData.append('projectId', projectId!);
        formData.append('commitHash', createForm.commitHash);
        formData.append('branch', createForm.branch);
        if (createForm.buildVersion) formData.append('buildVersion', createForm.buildVersion);
        if (createForm.gitDiff) formData.append('gitDiff', createForm.gitDiff);

        await buildApi.create(formData, (e) => {
          if (e.total) {
            setUploadProgress(Math.round((e.loaded * 100) / e.total));
          }
        });
      } else {
        // === 蒲公英下载流程 ===
        setPgyerStatus('Initiating download from Pgyer...');
        setPgyerDownloadProgress(0);

        const taskRes = await buildApi.createFromPgyer({
          projectId: projectId!,
          pgyerUrl,
          commitHash: createForm.commitHash,
          branch: createForm.branch,
          buildVersion: createForm.buildVersion || undefined,
          gitDiff: createForm.gitDiff || undefined,
        });

        const taskId = taskRes.data.data.taskId;
        const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

        await new Promise<void>((resolve, reject) => {
          const evtSource = new EventSource(`${API_BASE}/builds/pgyer-progress/${taskId}`);

          evtSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            switch (data.status) {
              case 'fetching_plist':
                setPgyerStatus('Fetching download info from Pgyer...');
                setPgyerDownloadProgress(5);
                break;
              case 'downloading':
                if (data.progress && data.progress.total > 0) {
                  const pct = Math.round((data.progress.downloaded / data.progress.total) * 90) + 5;
                  const dlMB = (data.progress.downloaded / (1024 * 1024)).toFixed(1);
                  const totalMB = (data.progress.total / (1024 * 1024)).toFixed(1);
                  setPgyerStatus(`Downloading: ${data.filename || 'IPA'} (${dlMB} MB / ${totalMB} MB)`);
                  setPgyerDownloadProgress(Math.min(pct, 95));
                } else {
                  setPgyerStatus(`Downloading: ${data.filename || 'IPA'}...`);
                  setPgyerDownloadProgress(10);
                }
                break;
              case 'extracting':
                setPgyerStatus('Extracting binary from IPA...');
                setPgyerDownloadProgress(96);
                break;
              case 'complete':
                setPgyerStatus('Build created successfully!');
                setPgyerDownloadProgress(100);
                evtSource.close();
                resolve();
                break;
              case 'error':
                evtSource.close();
                reject(new Error(data.error || 'Pgyer download failed'));
                break;
            }
          };

          evtSource.onerror = () => {
            evtSource.close();
            reject(new Error('Lost connection to server'));
          };
        });
      }

      // 成功后清理状态
      setShowCreateModal(false);
      setCreateForm({ commitHash: '', branch: '', buildVersion: '', gitDiff: '' });
      setBinaryFile(null);
      setPgyerUrl('');
      setBinarySource('file');
      setUploadProgress(0);
      setPgyerDownloadProgress(0);
      setPgyerStatus('');
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to create build');
    } finally {
      setCreating(false);
    }
  };

  const handleViewRawUploads = async (build: Build) => {
    setSelectedBuild(build);
    setShowRawUploadsModal(true);
    setRawUploadsLoading(true);
    try {
      const res = await buildApi.getRawUploads(build.id);
      setRawUploads(res.data.data || []);
    } catch (err) {
      setError('Failed to load raw uploads');
    } finally {
      setRawUploadsLoading(false);
    }
  };

  const handleRemerge = async (build: Build) => {
    try {
      await buildApi.remerge(build.id);
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Remerge failed');
    }
  };

  const handleDeleteClick = (build: Build) => {
    setBuildToDelete(build);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!buildToDelete) return;
    try {
      setDeleting(true);
      await buildApi.delete(buildToDelete.id);
      setBuilds(builds.filter(b => b.id !== buildToDelete.id));
      setShowDeleteModal(false);
      setBuildToDelete(null);
    } catch (err) {
      setError('Failed to delete build');
    } finally {
      setDeleting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready': return <Badge bg="success">Ready</Badge>;
      case 'error': return <Badge bg="danger">Error</Badge>;
      default: return <Badge bg="secondary">{status}</Badge>;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
          <h2 className="mb-1">
            Build Management
            {project && (
              <Badge bg={project.platform === 'ios' ? 'dark' : project.platform === 'python' ? 'info' : 'success'} className="ms-2 fs-6">
                {project.platform}
              </Badge>
            )}
          </h2>
          <p className="text-muted mb-0">
            {project?.name} - Manage builds and raw coverage uploads
          </p>
        </div>
        <div className="d-flex gap-2">
          <Link to={`/projects/${projectId}`} className="btn btn-outline-secondary">
            Back to Reports
          </Link>
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            Create Build
          </Button>
        </div>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body>
          {builds.length === 0 ? (
            <div className="text-center py-5">
              <p className="text-muted">No builds yet</p>
              <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                Create First Build
              </Button>
            </div>
          ) : (
            <Table hover responsive>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Commit</th>
                  <th>Branch</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Uploads</th>
                  <th>Last Merged</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {builds.map(build => (
                  <tr key={build.id}>
                    <td>{new Date(build.createdAt).toLocaleString()}</td>
                    <td><code>{build.commitHash.substring(0, 7)}</code></td>
                    <td><Badge bg="secondary">{build.branch}</Badge></td>
                    <td>{build.buildVersion || '-'}</td>
                    <td>{getStatusBadge(build.status)}</td>
                    <td>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={() => handleViewRawUploads(build)}
                      >
                        {build.rawUploadCount} files
                      </Button>
                    </td>
                    <td>
                      {build.lastMergedAt
                        ? new Date(build.lastMergedAt).toLocaleString()
                        : '-'}
                    </td>
                    <td>
                      <div className="d-flex gap-1">
                        {build.mergedReportId && (
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => navigate(`/report/${build.mergedReportId}`)}
                          >
                            Report
                          </Button>
                        )}
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => handleRemerge(build)}
                          disabled={build.rawUploadCount === 0}
                        >
                          Remerge
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() => handleDeleteClick(build)}
                        >
                          Delete
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

      {/* Create Build Modal */}
      <Modal show={showCreateModal} onHide={() => {
        if (!creating) {
          setShowCreateModal(false);
          setBinarySource('file');
          setPgyerUrl('');
          setPgyerStatus('');
          setPgyerDownloadProgress(0);
        }
      }} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Create Build</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            {/* iOS 项目显示来源选择 */}
            {project?.platform === 'ios' && (
              <Form.Group className="mb-3">
                <Form.Label>Binary Source *</Form.Label>
                <div className="d-flex gap-3">
                  <Form.Check
                    type="radio"
                    label="Upload File"
                    name="binarySource"
                    checked={binarySource === 'file'}
                    onChange={() => setBinarySource('file')}
                    disabled={creating}
                  />
                  <Form.Check
                    type="radio"
                    label="Download from Pgyer (蒲公英)"
                    name="binarySource"
                    checked={binarySource === 'pgyer'}
                    onChange={() => setBinarySource('pgyer')}
                    disabled={creating}
                  />
                </div>
              </Form.Group>
            )}

            {/* 文件上传（原有功能） */}
            {(binarySource === 'file' || project?.platform !== 'ios') && (
              <Form.Group className="mb-3">
                <Form.Label>Binary File *</Form.Label>
                <Form.Control
                  type="file"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setBinaryFile(e.target.files?.[0] || null);
                  }}
                  disabled={creating}
                />
                <Form.Text className="text-muted">
                  {project?.platform === 'ios'
                    ? 'Upload the Mach-O binary (e.g., the app executable from .app bundle)'
                    : 'Upload classfiles.zip (compiled .class files)'}
                </Form.Text>
              </Form.Group>
            )}

            {/* 蒲公英 URL 输入 */}
            {binarySource === 'pgyer' && project?.platform === 'ios' && (
              <Form.Group className="mb-3">
                <Form.Label>Pgyer URL *</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="https://www.pgyer.com/xxxxxxxx"
                  value={pgyerUrl}
                  onChange={e => setPgyerUrl(e.target.value)}
                  disabled={creating}
                />
                <Form.Text className="text-muted">
                  Paste the Pgyer download page URL. The IPA will be downloaded and the Mach-O binary extracted automatically.
                </Form.Text>
              </Form.Group>
            )}

            <Form.Group className="mb-3">
              <Form.Label>Commit Hash *</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., abc1234..."
                value={createForm.commitHash}
                onChange={e => setCreateForm({ ...createForm, commitHash: e.target.value })}
                disabled={creating}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Branch *</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., main, develop"
                value={createForm.branch}
                onChange={e => setCreateForm({ ...createForm, branch: e.target.value })}
                disabled={creating}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Build Version</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., 1.0.0-beta1"
                value={createForm.buildVersion}
                onChange={e => setCreateForm({ ...createForm, buildVersion: e.target.value })}
                disabled={creating}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Git Diff (for incremental coverage)</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                placeholder="Paste git diff output here (optional)"
                value={createForm.gitDiff}
                onChange={e => setCreateForm({ ...createForm, gitDiff: e.target.value })}
                disabled={creating}
              />
            </Form.Group>
            {/* 上传进度 */}
            {creating && binarySource === 'file' && uploadProgress > 0 && (
              <ProgressBar now={uploadProgress} label={`${uploadProgress}%`} className="mb-3" />
            )}
            {/* 蒲公英下载进度 */}
            {creating && binarySource === 'pgyer' && (
              <div className="mb-3">
                <div className="text-muted small mb-1">{pgyerStatus}</div>
                <ProgressBar
                  now={pgyerDownloadProgress}
                  label={pgyerDownloadProgress > 0 ? `${pgyerDownloadProgress}%` : ''}
                  animated={pgyerDownloadProgress > 0 && pgyerDownloadProgress < 100}
                />
              </div>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowCreateModal(false)} disabled={creating}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreateBuild} disabled={creating}>
            {creating
              ? (binarySource === 'pgyer' ? 'Downloading...' : 'Uploading...')
              : 'Create Build'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Raw Uploads Modal */}
      <Modal show={showRawUploadsModal} onHide={() => setShowRawUploadsModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            Raw Uploads - {selectedBuild?.commitHash.substring(0, 7)}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {rawUploadsLoading ? (
            <div className="text-center py-3">
              <Spinner animation="border" size="sm" />
            </div>
          ) : rawUploads.length === 0 ? (
            <p className="text-muted text-center">No raw uploads yet</p>
          ) : (
            <Table hover size="sm">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>File</th>
                  <th>Size</th>
                  <th>Tester</th>
                  <th>Device</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rawUploads.map(raw => (
                  <tr key={raw.id}>
                    <td>{new Date(raw.createdAt).toLocaleString()}</td>
                    <td className="text-truncate" style={{ maxWidth: '200px' }}>
                      {raw.originalFilename}
                    </td>
                    <td>{formatFileSize(raw.fileSize)}</td>
                    <td>{raw.testerName || '-'}</td>
                    <td>{raw.deviceInfo || '-'}</td>
                    <td>
                      <Badge bg={
                        raw.status === 'merged' ? 'success' :
                        raw.status === 'error' ? 'danger' : 'warning'
                      }>
                        {raw.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal.Body>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {buildToDelete && (
            <>
              <p>Are you sure you want to delete this build?</p>
              <ul className="list-unstyled">
                <li><strong>Commit:</strong> <code>{buildToDelete.commitHash.substring(0, 7)}</code></li>
                <li><strong>Branch:</strong> {buildToDelete.branch}</li>
                <li><strong>Uploads:</strong> {buildToDelete.rawUploadCount} files</li>
              </ul>
              <p className="text-danger mb-0">This will delete all associated raw uploads and the merged report. This action cannot be undone!</p>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirmDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default Builds;
