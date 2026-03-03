import { db } from '../models/database';
import { Project } from '../types';

export class ProjectService {
  
  static createProject(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project {
    return db.createProject(project);
  }

  static getAllProjects(): Project[] {
    return db.getAllProjects();
  }

  static getProjectById(id: number): Project | null {
    return db.getProjectById(id) || null;
  }

  static getProjectsByPlatform(platform: 'ios' | 'android'): Project[] {
    return db.getProjectsByPlatform(platform);
  }

  static updateProject(id: number, updates: Partial<Project>): Project | null {
    return db.updateProject(id, updates) || null;
  }

  static deleteProject(id: number): boolean {
    return db.deleteProject(id);
  }

  static searchProjects(query: string): Project[] {
    return db.searchProjects(query);
  }
}

export default ProjectService;
