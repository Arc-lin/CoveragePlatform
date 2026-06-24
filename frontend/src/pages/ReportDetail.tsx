import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Badge, Button, Spinner, Alert, ListGroup, Row, Col, ProgressBar, Form } from 'react-bootstrap';
import { coverageApi, projectApi } from '../services/api';
import { CoverageReport, Project, FileInfo, LineCoverageDetail, IncrementalSummary } from '../types';
import { getCoverageColor, getCoverageBadge } from '../utils/coverage';

const ReportDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [allFiles, setAllFiles] = useState<FileInfo[]>([]);
  const [incrementalFiles, setIncrementalFiles] = useState<FileInfo[]>([]);
  const [incrementalSummary, setIncrementalSummary] = useState<IncrementalSummary | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileCoverage, setFileCoverage] = useState<LineCoverageDetail[]>([]);
  const [sourceCode, setSourceCode] = useState<string[] | null>(null);
  const [sourceRepo, setSourceRepo] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState('');
  const [showIncremental, setShowIncremental] = useState(false);
  const [loadingIncremental, setLoadingIncremental] = useState(false);
  const [showFullCoverage, setShowFullCoverage] = useState(false);
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadReport(id);
    }
  }, [id]);

  const loadReport = async (reportId: string) => {
    try {
      setLoading(true);

      // 第一步：获取报告详情
      const reportRes = await coverageApi.getById(reportId);
      const reportData = reportRes.data.data;
      setReport(reportData);

      if (reportData) {
        // 第二步：并行获取项目信息和文件列表
        const [projectRes, filesRes] = await Promise.all([
          projectApi.getById(reportData.projectId),
          coverageApi.getFileCoverage(reportId),
        ]);
        setProject(projectRes.data.data);
        setAllFiles(filesRes.data.data || []);

        // 第三步（条件性）：获取增量数据。多模块组件化报告没有顶层 gitDiff
        // （diff 按模块拆在 Build.moduleDiffs 里），但后端 /incremental 接口已经支持按
        // moduleCoverages 算增量文件列表，所以这里两种情况都要触发
        if (reportData.gitDiff || reportData.moduleCoverages) {
          try {
            const incrementalRes = await coverageApi.getIncrementalFilesAuto(reportId);
            if (incrementalRes.data.success) {
              setIncrementalFiles(incrementalRes.data.data || []);
              const summaryData = incrementalRes.data.summary;
              setIncrementalSummary(summaryData || null);
              setShowIncremental(true);
            }
          } catch (err) {
            console.log('No incremental data available:', err);
          }
        }
      }

      setError(null);
    } catch (err) {
      setError('Failed to load report details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeIncremental = async () => {
    if (!diffContent.trim()) {
      setError('Please enter Git diff content');
      return;
    }

    try {
      setLoadingIncremental(true);
      setError(null);

      const res = await coverageApi.getIncrementalFiles(id!, diffContent);
      
      if (res.data.success) {
        setIncrementalFiles(res.data.data || []);
        // summary 可能在 response 的顶层
        const summaryData = res.data.summary;
        setIncrementalSummary(summaryData || null);
        setShowIncremental(true);
      } else {
        setError(res.data.message || 'Failed to analyze incremental coverage');
      }
    } catch (err) {
      setError('Failed to analyze incremental coverage');
      console.error(err);
    } finally {
      setLoadingIncremental(false);
    }
  };

  const handleFileClick = async (filePath: string) => {
    try {
      setSelectedFile(filePath);
      setFileCoverage([]); // 清空旧数据，触发 loading 状态
      setSourceCode(null);
      setSourceRepo(null);
      setSourceError(null);

      // 并行获取覆盖率数据和源码（多模块组件化报告同样靠后端按 module 解析对应的
      // reportPath/diff，前端只看有没有 gitDiff 或 moduleCoverages 来决定走哪条接口）
      const coveragePromise = showIncremental && (report?.gitDiff || report?.moduleCoverages)
        ? coverageApi.getIncrementalFileDetail(id!, filePath)
        : coverageApi.getFileDetail(id!, filePath);

      const sourcePromise = coverageApi.getSourceCode(id!, filePath).catch((err) => err);

      const [coverageRes, sourceRes] = await Promise.all([coveragePromise, sourcePromise]);

      setFileCoverage(coverageRes.data.data?.lines || []);

      if (sourceRes?.data?.data?.content) {
        setSourceCode(sourceRes.data.data.content.split('\n'));
        setSourceRepo(sourceRes.data.data.sourceRepo || null);
      } else {
        // 组件化项目：壳工程和所有已注册的组件仓库都没找到这个文件
        setSourceError(sourceRes?.response?.data?.message || '源码未找到');
      }
    } catch (err) {
      setError('Failed to load file coverage');
      console.error('Failed to load file coverage:', err);
    }
  };


  // 获取当前显示的文件列表（多仓库组件化项目：点了某个模块的话只看这个模块的文件——
  // 增量文件列表目前没有按模块打标，筛选只对全量文件列表生效）
  const currentFiles = showIncremental
    ? incrementalFiles
    : allFiles.filter((f) => !moduleFilter || f.module === moduleFilter);

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3 text-muted">Loading report details...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div>
        <Alert variant="danger">Report not found</Alert>
        <Button variant="primary" onClick={() => navigate('/reports')}>
          Back to Reports
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">Coverage Report Details</h2>
          <p className="text-muted mb-0">
            {project?.name} 
            <Badge bg={project?.platform === 'ios' ? 'dark' : 'success'} className="ms-2">
              {project?.platform}
            </Badge>
          </p>
        </div>
        <Button variant="outline-secondary" onClick={() => navigate(-1)}>
          ← Back
        </Button>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}

      {/* Report Info Card */}
      <Card className="border-0 shadow-sm mb-4">
        <Card.Header className="bg-primary text-white">
          <h5 className="mb-0"><i className="bi bi-clipboard-data me-2"></i>Report Information</h5>
        </Card.Header>
        <Card.Body>
          <Row>
            <Col md={6}>
              <table className="table table-borderless">
                <tbody>
                  <tr>
                    <td className="text-muted">Report ID:</td>
                    <td><code>#{report.id}</code></td>
                  </tr>
                  <tr>
                    <td className="text-muted">Commit Hash:</td>
                    <td>
                      <code className="bg-light px-2 py-1 rounded">
                        {report.commitHash.substring(0, 7)}
                      </code>
                      <span className="text-muted ms-2">({report.commitHash})</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted">Branch:</td>
                    <td>
                      <Badge bg="secondary">{report.branch}</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted">Created At:</td>
                    <td>{new Date(report.createdAt).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </Col>
            <Col md={6}>
              {/* 增量覆盖率优先展示 */}
              {incrementalSummary ? (
                <>
                  <h6 className="mb-3">
                    Incremental Coverage
                    <Badge bg="info" className="ms-2" style={{ fontSize: '0.7em' }}>Δ</Badge>
                  </h6>
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <span>Incremental Coverage</span>
                      {getCoverageBadge(incrementalSummary.averageIncrementalCoverage)}
                    </div>
                    <ProgressBar
                      now={incrementalSummary.averageIncrementalCoverage}
                      variant={getCoverageColor(incrementalSummary.averageIncrementalCoverage)}
                      style={{ height: '10px' }}
                    />
                  </div>
                  <Row className="mb-3">
                    <Col xs={6}>
                      <div className="text-center p-2 bg-light rounded">
                        <div className="h5 mb-0 text-info">{incrementalSummary.totalFiles}</div>
                        <small className="text-muted">Changed Files</small>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="text-center p-2 bg-light rounded">
                        <div className="h5 mb-0 text-warning">{incrementalSummary.totalChangedLines}</div>
                        <small className="text-muted">Changed Lines</small>
                      </div>
                    </Col>
                  </Row>

                  {/* 全量覆盖率折叠展示 */}
                  <div className="border-top pt-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 text-muted text-decoration-none"
                      onClick={() => setShowFullCoverage(!showFullCoverage)}
                    >
                      {showFullCoverage ? '▼' : '▶'} Full Coverage Details
                    </Button>
                    {showFullCoverage && (
                      <div className="mt-2">
                        <div className="mb-2">
                          <div className="d-flex justify-content-between mb-1">
                            <small>Line Coverage</small>
                            <small className={`text-${getCoverageColor(report.lineCoverage)}`}>{report.lineCoverage.toFixed(1)}%</small>
                          </div>
                          <ProgressBar now={report.lineCoverage} variant={getCoverageColor(report.lineCoverage)} style={{ height: '6px' }} />
                        </div>
                        <div className="mb-2">
                          <div className="d-flex justify-content-between mb-1">
                            <small>Function Coverage</small>
                            <small className={`text-${getCoverageColor(report.functionCoverage)}`}>{report.functionCoverage.toFixed(1)}%</small>
                          </div>
                          <ProgressBar now={report.functionCoverage} variant={getCoverageColor(report.functionCoverage)} style={{ height: '6px' }} />
                        </div>
                        <div className="mb-2">
                          <div className="d-flex justify-content-between mb-1">
                            <small>Branch Coverage</small>
                            <small className={`text-${getCoverageColor(report.branchCoverage)}`}>{report.branchCoverage.toFixed(1)}%</small>
                          </div>
                          <ProgressBar now={report.branchCoverage} variant={getCoverageColor(report.branchCoverage)} style={{ height: '6px' }} />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : report.incrementalCoverage !== undefined ? (
                <>
                  {/* 多仓库组件化项目：增量覆盖率是按 moduleCoverages 算出来存在 report 上的，
                      不是靠这里手动贴 diff 触发的 incrementalSummary 抓取（那个依赖 report.gitDiff，
                      组件化项目用的是 Build.moduleDiffs，对不上，所以走这个分支单独处理） */}
                  <h6 className="mb-3">
                    Incremental Coverage
                    <Badge bg="info" className="ms-2" style={{ fontSize: '0.7em' }}>Δ</Badge>
                  </h6>
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <span>Incremental Coverage（按模块加权聚合）</span>
                      {getCoverageBadge(report.incrementalCoverage)}
                    </div>
                    <ProgressBar
                      now={report.incrementalCoverage}
                      variant={getCoverageColor(report.incrementalCoverage)}
                      style={{ height: '10px' }}
                    />
                  </div>
                  {report.moduleCoverages && report.moduleCoverages.length > 0 && (
                    <div className="mb-3">
                      {report.moduleCoverages.map((m) => (
                        <div key={m.module} className="d-flex justify-content-between align-items-center mb-1">
                          <small className="text-muted">
                            <Badge bg="secondary" className="me-1">{m.module}</Badge>
                          </small>
                          {m.incrementalCoverage !== undefined ? (
                            <Badge bg={getCoverageColor(m.incrementalCoverage)}>Δ {m.incrementalCoverage.toFixed(0)}%</Badge>
                          ) : (
                            <small className="text-muted">无改动</small>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 全量覆盖率折叠展示 */}
                  <div className="border-top pt-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 text-muted text-decoration-none"
                      onClick={() => setShowFullCoverage(!showFullCoverage)}
                    >
                      {showFullCoverage ? '▼' : '▶'} Full Coverage Details
                    </Button>
                    {showFullCoverage && (
                      <div className="mt-2">
                        <div className="mb-2">
                          <div className="d-flex justify-content-between mb-1">
                            <small>Line Coverage</small>
                            <small className={`text-${getCoverageColor(report.lineCoverage)}`}>{report.lineCoverage.toFixed(1)}%</small>
                          </div>
                          <ProgressBar now={report.lineCoverage} variant={getCoverageColor(report.lineCoverage)} style={{ height: '6px' }} />
                        </div>
                        <div className="mb-2">
                          <div className="d-flex justify-content-between mb-1">
                            <small>Function Coverage</small>
                            <small className={`text-${getCoverageColor(report.functionCoverage)}`}>{report.functionCoverage.toFixed(1)}%</small>
                          </div>
                          <ProgressBar now={report.functionCoverage} variant={getCoverageColor(report.functionCoverage)} style={{ height: '6px' }} />
                        </div>
                        <div className="mb-2">
                          <div className="d-flex justify-content-between mb-1">
                            <small>Branch Coverage</small>
                            <small className={`text-${getCoverageColor(report.branchCoverage)}`}>{report.branchCoverage.toFixed(1)}%</small>
                          </div>
                          <ProgressBar now={report.branchCoverage} variant={getCoverageColor(report.branchCoverage)} style={{ height: '6px' }} />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h6 className="mb-3">Coverage Summary</h6>
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <span>Line Coverage</span>
                      {getCoverageBadge(report.lineCoverage)}
                    </div>
                    <ProgressBar
                      now={report.lineCoverage}
                      variant={getCoverageColor(report.lineCoverage)}
                      style={{ height: '10px' }}
                    />
                  </div>
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <span>Function Coverage</span>
                      {getCoverageBadge(report.functionCoverage)}
                    </div>
                    <ProgressBar
                      now={report.functionCoverage}
                      variant={getCoverageColor(report.functionCoverage)}
                      style={{ height: '10px' }}
                    />
                  </div>
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <span>Branch Coverage</span>
                      {getCoverageBadge(report.branchCoverage)}
                    </div>
                    <ProgressBar
                      now={report.branchCoverage}
                      variant={getCoverageColor(report.branchCoverage)}
                      style={{ height: '10px' }}
                    />
                  </div>
                </>
              )}
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* 多仓库组件化项目：按模块/仓库拆分的覆盖率汇总 */}
      {report.moduleCoverages && report.moduleCoverages.length > 0 && (
        <Card className="border-0 shadow-sm mb-4">
          <Card.Header className="bg-light">
            <h6 className="mb-0"><i className="bi bi-diagram-3 me-2"></i>Module Coverage</h6>
          </Card.Header>
          <Card.Body className="p-0">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Line Coverage</th>
                  <th>Function Coverage</th>
                  <th>Branch Coverage</th>
                  <th>Incremental Coverage</th>
                  <th>Lines</th>
                </tr>
              </thead>
              <tbody>
                {report.moduleCoverages.map((m) => (
                  <tr
                    key={m.module}
                    role="button"
                    onClick={() => setModuleFilter(moduleFilter === m.module ? null : m.module)}
                    className={moduleFilter === m.module ? 'table-active' : ''}
                  >
                    <td>
                      <Badge bg="secondary" className="me-2">{m.module}</Badge>
                      {m.repositoryUrl && (
                        <small className="text-muted">{m.repositoryUrl.replace(/^https?:\/\//, '')}</small>
                      )}
                    </td>
                    <td>{getCoverageBadge(m.lineCoverage)}</td>
                    <td>{getCoverageBadge(m.functionCoverage)}</td>
                    <td>{getCoverageBadge(m.branchCoverage)}</td>
                    <td>{m.incrementalCoverage !== undefined ? getCoverageBadge(m.incrementalCoverage) : <span className="text-muted">—</span>}</td>
                    <td className="text-muted">{m.coveredLines}/{m.totalLines}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card.Body>
          {moduleFilter && (
            <Card.Footer className="py-2">
              <small className="text-muted">
                只看「{moduleFilter}」模块的文件——
                <Button variant="link" size="sm" className="p-0 align-baseline" onClick={() => setModuleFilter(null)}>
                  清除筛选
                </Button>
              </small>
            </Card.Footer>
          )}
        </Card>
      )}

      {/* Incremental Coverage Analysis - 只在无 gitDiff 时显示手动输入；多仓库组件化项目
          走 moduleDiffs，不是这里贴单份 diff 的场景，也不显示 */}
      {!report?.gitDiff && !report?.moduleCoverages && (
        <Card className="border-0 shadow-sm mb-4">
          <Card.Header className="bg-info text-white">
            <h5 className="mb-0"><i className="bi bi-graph-up me-2"></i>Incremental Coverage Analysis</h5>
          </Card.Header>
          <Card.Body>
            <Form.Group className="mb-3">
              <Form.Label>Git Diff Content (paste diff output here)</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                placeholder="Paste git diff content here to analyze incremental coverage...&#10;Example: git diff HEAD~1 HEAD"
                value={diffContent}
                onChange={(e) => setDiffContent(e.target.value)}
              />
              <Form.Text className="text-muted">
                Paste the output of `git diff &lt;old-commit&gt; &lt;new-commit&gt;` to see coverage for only the changed files.
              </Form.Text>
            </Form.Group>

            <div className="d-flex gap-2">
              <Button
                variant="info"
                onClick={handleAnalyzeIncremental}
                disabled={loadingIncremental || !diffContent.trim()}
              >
                {loadingIncremental ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Analyzing...
                  </>
                ) : (
                  'Analyze Incremental Coverage'
                )}
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* 视图切换 */}
      {incrementalFiles.length > 0 && (
        <div className="d-flex gap-2 mb-3">
          <Button
            variant={showIncremental ? "info" : "outline-secondary"}
            onClick={() => setShowIncremental(true)}
          >
            Incremental Files ({incrementalFiles.length})
          </Button>
          <Button
            variant={!showIncremental ? "secondary" : "outline-secondary"}
            onClick={() => setShowIncremental(false)}
          >
            All Files ({allFiles.length})
          </Button>
        </div>
      )}

      {/* Files and Code View */}
      <Row>
        {/* File List */}
        <Col md={4}>
          <Card className="border-0 shadow-sm">
            <Card.Header className="bg-light d-flex justify-content-between align-items-center">
              <h6 className="mb-0">
                {showIncremental ? (
                  <>
                    <i className="bi bi-folder2-open me-2"></i>Changed Files
                    <Badge bg="info" className="ms-2">{currentFiles.length}</Badge>
                  </>
                ) : (
                  <>
                    <i className="bi bi-folder2 me-2"></i>All Files
                    <Badge bg="secondary" className="ms-2">{currentFiles.length}</Badge>
                  </>
                )}
              </h6>
              {showIncremental && (
                <Badge bg="warning" text="dark">Incremental</Badge>
              )}
            </Card.Header>
            <ListGroup variant="flush" style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {currentFiles.length === 0 ? (
                <ListGroup.Item className="text-center text-muted py-4">
                  {showIncremental ? (
                    <div>
                      <div className="mb-2"><i className="bi bi-file-earmark-text empty-state-icon"></i></div>
                      <div>No changed files found</div>
                      <small>This commit may not have any changes or no coverage data for changed files</small>
                    </div>
                  ) : (
                    'No files found'
                  )}
                </ListGroup.Item>
              ) : (
                currentFiles.map((file, index) => (
                  <ListGroup.Item
                    key={index}
                    action
                    active={selectedFile === file.filePath}
                    onClick={() => handleFileClick(file.filePath)}
                    className="d-flex flex-column"
                  >
                    <div className="d-flex justify-content-between align-items-center">
                      <div className="text-truncate" style={{ maxWidth: '60%' }}>
                        {file.module && (
                          <Badge bg="light" text="dark" className="me-1 border">{file.module}</Badge>
                        )}
                        <small title={file.filePath}>{file.filePath.split('/').pop()}</small>
                      </div>
                      <Badge
                        bg={getCoverageColor(file.lineCoverage)}
                        className="ms-2"
                      >
                        {file.lineCoverage.toFixed(0)}%
                      </Badge>
                    </div>
                    
                    {/* Show incremental info if in incremental mode */}
                    {showIncremental && file.changedLines && (
                      <div className="mt-1 d-flex justify-content-between align-items-center">
                        <small className="text-muted">
                          {file.changedLines.length} lines changed
                        </small>
                        {file.incrementalCoverage !== undefined && (
                          <Badge 
                            bg={getCoverageColor(file.incrementalCoverage)}
                            className="ms-2"
                            title="Incremental Coverage"
                          >
                            Δ {file.incrementalCoverage.toFixed(0)}%
                          </Badge>
                        )}
                      </div>
                    )}
                  </ListGroup.Item>
                ))
              )}
            </ListGroup>
          </Card>
        </Col>

        {/* Code View */}
        <Col md={8}>
          <Card className="border-0 shadow-sm">
            <Card.Header className="bg-light d-flex justify-content-between align-items-center">
              <div>
                <h6 className="mb-0">
                  {selectedFile ? `${selectedFile.split('/').pop()}` : 'Select a file to view coverage'}
                </h6>
                {sourceRepo && (
                  <small className="text-muted">来源：{sourceRepo}</small>
                )}
              </div>
              {!selectedFile && (
                <small className="text-muted">Click a file to view source code with coverage</small>
              )}
              {selectedFile && fileCoverage.length > 0 && (
                <div className="d-flex gap-2">
                  {showIncremental ? (
                    <>
                      <Badge bg="success">✓ Changed & Covered</Badge>
                      <Badge bg="danger">✗ Changed & Uncovered</Badge>
                      <Badge bg="light" text="dark">○ Unchanged</Badge>
                    </>
                  ) : (
                    <>
                      <Badge bg="success">✓ Covered</Badge>
                      <Badge bg="danger">✗ Uncovered</Badge>
                    </>
                  )}
                </div>
              )}
            </Card.Header>
            {sourceError && (
              <Alert variant="warning" className="m-2 mb-0 py-2 small">
                源码未找到：{sourceError}
              </Alert>
            )}
            <Card.Body className="p-0">
              {selectedFile ? (
                fileCoverage.length > 0 ? (
                  <div
                    className="code-viewer"
                    style={{
                      maxHeight: '600px',
                      overflow: 'auto',
                    }}
                  >
                    {fileCoverage.map((line) => {
                      // 确定行的样式
                      let bgClass = '';
                      let borderColor = '';
                      let indicator = '';
                      
                      if (showIncremental && line.isChanged !== undefined) {
                        // 增量视图：只高亮变更行
                        if (line.isChanged) {
                          if (line.isCovered) {
                            bgClass = 'bg-success-subtle';
                            borderColor = '#198754';
                            indicator = '✓';
                          } else {
                            bgClass = 'bg-danger-subtle';
                            borderColor = '#dc3545';
                            indicator = '✗';
                          }
                        } else {
                          // 非变更行：白色背景，无指示器
                          bgClass = '';
                          borderColor = 'transparent';
                          indicator = '○';
                        }
                      } else {
                        // 全量视图：所有行都显示覆盖率
                        if (line.isCovered) {
                          bgClass = 'bg-success-subtle';
                          borderColor = '#198754';
                          indicator = '✓';
                        } else {
                          bgClass = 'bg-danger-subtle';
                          borderColor = '#dc3545';
                          indicator = '✗';
                        }
                      }
                      
                      return (
                        <div
                          key={line.lineNumber}
                          className={`d-flex ${bgClass}`}
                          style={{
                            borderLeft: `4px solid ${borderColor}`,
                            padding: '2px 0'
                          }}
                        >
                          {/* Line Number */}
                          <div
                            className="text-muted text-end pe-3"
                            style={{
                              minWidth: '55px',
                              userSelect: 'none' as const,
                              backgroundColor: '#f1f3f5',
                              borderRight: '1px solid #e5e7eb',
                              fontSize: '12px',
                            }}
                          >
                            {line.lineNumber}
                          </div>

                          {/* Coverage Indicator */}
                          <div
                            className="pe-2"
                            style={{ 
                              minWidth: '30px', 
                              textAlign: 'center',
                              color: line.isChanged ? (line.isCovered ? '#198754' : '#dc3545') : '#6c757d'
                            }}
                          >
                            {indicator}
                          </div>
                        
                          {/* Code Content */}
                          <div className="flex-grow-1 ps-2" style={{ whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {sourceCode && sourceCode[line.lineNumber - 1] !== undefined
                              ? sourceCode[line.lineNumber - 1] || ' '
                              : <span className="text-muted" style={{ fontStyle: 'italic' }}>{`Line ${line.lineNumber}`}</span>
                            }
                          </div>

                          {/* Coverage Count */}
                          <div
                            className="text-muted pe-3"
                            style={{ minWidth: '80px', textAlign: 'right', fontSize: '12px' }}
                          >
                            {line.coveredInstructions > 0 && (
                              <span className="text-success">+{line.coveredInstructions}</span>
                            )}
                            {line.missedInstructions > 0 && (
                              <span className="text-danger ms-1">-{line.missedInstructions}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-5 text-muted">
                    <Spinner animation="border" size="sm" className="me-2" />
                    Loading coverage data...
                  </div>
                )
              ) : (
                <div className="text-center py-5 text-muted">
                  <div className="empty-state-icon"><i className="bi bi-file-earmark-code"></i></div>
                  <p>Select a file from the list to view detailed coverage</p>
                </div>
              )}
            </Card.Body>
          </Card>
          
          {/* Legend */}
          {selectedFile && (
            <Card className="border-0 shadow-sm mt-3">
              <Card.Body className="py-2">
                <small className="text-muted">
                  <strong>Legend:</strong>
                  <span className="ms-3 text-success">✓ Covered</span>
                  <span className="ms-3 text-danger">✗ Uncovered</span>
                  <span className="ms-3 text-success">+N</span> Instructions covered
                  <span className="ms-3 text-danger">-N</span> Instructions missed
                </small>
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default ReportDetail;