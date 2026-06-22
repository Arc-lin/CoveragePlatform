import { Router, Request, Response } from 'express';
import { mongoDb } from '../models/database';
import { Project } from '../types';

const router = Router();

// accessToken 是敏感凭据，列表/详情接口不直接返回原值，只返回是否已配置
function sanitizeProject(project: Project) {
  const { accessToken, ...rest } = project;
  return { ...rest, hasAccessToken: !!accessToken };
}

// 获取所有项目
router.get('/', async (req: Request, res: Response) => {
  try {
    const { platform, search } = req.query;
    let projects;

    if (search) {
      projects = await mongoDb.searchProjects(search as string);
    } else if (platform && (platform === 'ios' || platform === 'android' || platform === 'python')) {
      projects = await mongoDb.getProjectsByPlatform(platform as 'ios' | 'android' | 'python');
    } else {
      projects = await mongoDb.getAllProjects();
    }

    res.json({ success: true, data: projects.map(sanitizeProject) });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch projects',
      error: (error as Error).message
    });
  }
});

// 创建项目
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, platform, repositoryUrl, accessToken } = req.body;

    if (!name || !platform || !repositoryUrl) {
      return res.status(400).json({
        success: false,
        message: 'Name, platform and repositoryUrl are required'
      });
    }

    if (platform !== 'ios' && platform !== 'android' && platform !== 'python') {
      return res.status(400).json({
        success: false,
        message: 'Platform must be ios, android, or python'
      });
    }

    const project = await mongoDb.createProject({
      name,
      platform,
      repositoryUrl,
      accessToken
    });

    res.status(201).json({ success: true, data: sanitizeProject(project) });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create project',
      error: (error as Error).message
    });
  }
});

// 获取单个项目
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const project = await mongoDb.getProjectById(id);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.json({ success: true, data: sanitizeProject(project) });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project',
      error: (error as Error).message
    });
  }
});

// 更新项目
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { name, platform, repositoryUrl, accessToken } = req.body;

    const updates: Partial<Project> = { name, platform, repositoryUrl };
    // 只有显式传了 accessToken 才更新，避免编辑表单留空时把已保存的 token 清掉
    if (accessToken !== undefined && accessToken !== '') {
      updates.accessToken = accessToken;
    }

    const project = await mongoDb.updateProject(id, updates);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.json({ success: true, data: sanitizeProject(project) });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update project',
      error: (error as Error).message
    });
  }
});

// 删除项目
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const success = await mongoDb.deleteProject(id);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete project',
      error: (error as Error).message
    });
  }
});

export default router;
