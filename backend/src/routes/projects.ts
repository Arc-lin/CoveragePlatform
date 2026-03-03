import { Router, Request, Response } from 'express';
import ProjectService from '../services/projectService';

const router = Router();

// 获取所有项目
router.get('/', (req: Request, res: Response) => {
  try {
    const { platform, search } = req.query;
    let projects;
    
    if (search) {
      projects = ProjectService.searchProjects(search as string);
    } else if (platform && (platform === 'ios' || platform === 'android')) {
      projects = ProjectService.getProjectsByPlatform(platform);
    } else {
      projects = ProjectService.getAllProjects();
    }
    
    res.json({ success: true, data: projects });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch projects',
      error: (error as Error).message 
    });
  }
});

// 创建项目
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, platform, repositoryUrl } = req.body;
    
    if (!name || !platform) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and platform are required' 
      });
    }
    
    if (platform !== 'ios' && platform !== 'android') {
      return res.status(400).json({ 
        success: false, 
        message: 'Platform must be ios or android' 
      });
    }
    
    const project = ProjectService.createProject({
      name,
      platform,
      repositoryUrl
    });
    
    res.status(201).json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create project',
      error: (error as Error).message 
    });
  }
});

// 获取单个项目
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const project = ProjectService.getProjectById(id);
    
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: 'Project not found' 
      });
    }
    
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch project',
      error: (error as Error).message 
    });
  }
});

// 更新项目
router.put('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { name, platform, repositoryUrl } = req.body;
    
    const project = ProjectService.updateProject(id, {
      name,
      platform,
      repositoryUrl
    });
    
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: 'Project not found' 
      });
    }
    
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update project',
      error: (error as Error).message 
    });
  }
});

// 删除项目
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const success = ProjectService.deleteProject(id);
    
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
