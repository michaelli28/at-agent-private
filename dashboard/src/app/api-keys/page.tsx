'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Project } from '@/types';
import { Key, Copy, Check, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

export default function ApiKeysPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
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
      })) as Project[];
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
        <p className="text-gray-600 mt-1">Manage API keys for submitting test results from CI/CD pipelines</p>
      </div>

      {projects.length > 0 ? (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>API Key</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td className="font-medium text-gray-900">{project.name}</td>
                    <td>
                      <code className="text-sm bg-gray-100 px-2 py-1 rounded font-mono">
                        {visibleKeys.has(project.id) ? project.apiKey : maskApiKey(project.apiKey)}
                      </code>
                    </td>
                    <td className="text-gray-500">
                      {project.createdAt?.toLocaleDateString()}
                    </td>
                    <td>
                      <div className="flex items-center space-x-2">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card p-12 text-center">
          <Key className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No API Keys</h3>
          <p className="text-gray-500 mb-6">Create a project first to get an API key</p>
          <Link href="/projects" className="btn btn-primary">
            Go to Projects
          </Link>
        </div>
      )}

    </div>
  );
}
