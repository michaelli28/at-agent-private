'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { Project } from '@/types';
import { FolderKanban, Plus, Trash2, Copy, Check, ExternalLink, Eye, EyeOff } from 'lucide-react';

function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'ak_';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchProjects();
  }, []);

  async function fetchProjects() {
    try {
      const snapshot = await getDocs(collection(db, 'projects'));
      const projectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate(),
        updatedAt: doc.data().updatedAt?.toDate(),
      })) as Project[];
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  }

  async function createProject() {
    if (!newProjectName.trim() || !user) return;

    setCreating(true);
    try {
      const apiKey = generateApiKey();
      await addDoc(collection(db, 'projects'), {
        name: newProjectName.trim(),
        description: newProjectDescription.trim(),
        apiKey,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowCreateModal(false);
      setNewProjectName('');
      setNewProjectDescription('');
      fetchProjects();
    } catch (error) {
      console.error('Error creating project:', error);
    } finally {
      setCreating(false);
    }
  }

  async function deleteProject(projectId: string, projectName: string) {
    if (!confirm(`Are you sure you want to delete "${projectName}"?\n\nThis will permanently delete:\n- The project\n- All test runs\n- All test results\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        console.log(`Deleted project: ${data.deletedTestRuns} test runs, ${data.deletedTestResults} test results`);
        fetchProjects();
      } else {
        console.error('Error deleting project:', data.error);
        alert('Failed to delete project: ' + data.error);
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('Failed to delete project. Please try again.');
    }
  }

  function copyApiKey(apiKey: string, projectId: string) {
    navigator.clipboard.writeText(apiKey);
    setCopiedId(projectId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function toggleKeyVisibility(projectId: string) {
    const newVisible = new Set(visibleKeys);
    if (newVisible.has(projectId)) {
      newVisible.delete(projectId);
    } else {
      newVisible.add(projectId);
    }
    setVisibleKeys(newVisible);
  }

  function maskApiKey(apiKey: string): string {
    return apiKey.substring(0, 6) + '•'.repeat(20) + apiKey.substring(apiKey.length - 4);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-600 mt-1">Manage your accessibility testing projects</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
          <Plus className="w-5 h-5 mr-2" />
          New Project
        </button>
      </div>

      {projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div key={project.id} className="card">
              <div className="card-body">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center mr-3">
                      <FolderKanban className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{project.name}</h3>
                      {project.description && (
                        <p className="text-sm text-gray-500">{project.description}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteProject(project.id, project.name)}
                    className="text-gray-400 hover:text-danger-600 transition-colors"
                    title="Delete project"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                <div className="border-t pt-4">
                  <label className="label">API Key</label>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 text-xs bg-gray-100 px-3 py-2 rounded font-mono truncate">
                      {visibleKeys.has(project.id) ? project.apiKey : maskApiKey(project.apiKey)}
                    </code>
                    <button
                      onClick={() => toggleKeyVisibility(project.id)}
                      className="btn btn-secondary btn-sm"
                      title={visibleKeys.has(project.id) ? 'Hide key' : 'Show key'}
                    >
                      {visibleKeys.has(project.id) ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => copyApiKey(project.apiKey, project.id)}
                      className="btn btn-secondary btn-sm"
                      title="Copy key"
                    >
                      {copiedId === project.id ? (
                        <Check className="w-4 h-4 text-success-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <Link
                    href={`/projects/${project.id}`}
                    className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center"
                  >
                    View Details <ExternalLink className="w-4 h-4 ml-1" />
                  </Link>
                  <span className="text-xs text-gray-400">
                    Created {project.createdAt?.toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <FolderKanban className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
          <p className="text-gray-500 mb-6">Create your first project to start tracking accessibility tests</p>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
            <Plus className="w-5 h-5 mr-2" />
            Create Project
          </button>
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Create New Project</h2>

            <div className="space-y-4">
              <div>
                <label className="label">Project Name *</label>
                <input
                  type="text"
                  className="input"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="My Website"
                />
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="Optional description for this project"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="btn btn-secondary"
                disabled={creating}
              >
                Cancel
              </button>
              <button
                onClick={createProject}
                className="btn btn-primary"
                disabled={creating || !newProjectName.trim()}
              >
                {creating ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
