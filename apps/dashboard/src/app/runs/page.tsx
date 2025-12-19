'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { collection, query, limit, onSnapshot, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { TestRun, Project } from '@/types';
import { History, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

export default function TestRunsPage() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<(TestRun & { projectName?: string })[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState<string>('all');
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const projectsRef = useRef<Project[]>([]);
  const projectIdsRef = useRef<string[]>([]);

  // Fetch user's projects first
  useEffect(() => {
    if (!user) {
      setProjects([]);
      projectsRef.current = [];
      projectIdsRef.current = [];
      setLoading(false);
      return;
    }

    const projectsQuery = query(
      collection(db, 'projects'),
      where('ownerId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(projectsQuery, (snapshot) => {
      const projectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as Project[];

      setProjects(projectsData);
      projectsRef.current = projectsData;
      projectIdsRef.current = projectsData.map(p => p.id);
    });

    return () => unsubscribe();
  }, [user]);

  // Subscribe to real-time updates for runs (filtered by user's projects)
  useEffect(() => {
    if (!user || projects.length === 0) {
      if (!user) {
        setRuns([]);
        setLoading(false);
      } else if (projects.length === 0 && projectsRef.current.length === 0) {
        setRuns([]);
        setLoading(false);
      }
      return;
    }

    const projectIds = projectIdsRef.current;
    if (projectIds.length === 0) return;

    // Firestore 'in' query supports up to 30 items
    // Query without orderBy to avoid composite index requirement, sort client-side
    const projectIdsToQuery = projectIds.slice(0, 30);

    const q = query(
      collection(db, 'testRuns'),
      where('projectId', 'in', projectIdsToQuery),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const runsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate(),
          completedAt: data.completedAt?.toDate(),
          projectName: projectsRef.current.find(p => p.id === data.projectId)?.name || 'Unknown Project'
        };
      }) as (TestRun & { projectName?: string })[];

      // Sort client-side by createdAt descending
      runsData.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      setRuns(runsData);
      setLoading(false);
    }, (error) => {
      console.error('Error subscribing to runs:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, projects]);

  const filteredRuns = runs.filter(run => {
    if (filterProject !== 'all' && run.projectId !== filterProject) return false;
    if (filterPlatform !== 'all' && run.platform !== filterPlatform) return false;
    return true;
  });

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Test Runs</h1>
        <p className="text-gray-600 mt-1">View all accessibility test runs across projects</p>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="card-body flex items-center space-x-4">
          <div>
            <label className="label">Project</label>
            <select
              className="input"
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
            >
              <option value="all">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Platform</label>
            <select
              className="input"
              value={filterPlatform}
              onChange={(e) => setFilterPlatform(e.target.value)}
            >
              <option value="all">All Platforms</option>
              <option value="jenkins">Jenkins</option>
              <option value="github-actions">GitHub Actions</option>
              <option value="azure-devops">Azure DevOps</option>
              <option value="gitlab-ci">GitLab CI</option>
              <option value="dashboard">Dashboard Rerun</option>
            </select>
          </div>
        </div>
      </div>

      {/* Runs Table */}
      <div className="card">
        <div className="overflow-x-auto">
          {loading && runs.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : filteredRuns.length > 0 ? (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Platform</th>
                    <th>Build</th>
                    <th>Branch</th>
                    <th>Tests</th>
                    <th>Pass Rate</th>
                    <th>Duration</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="font-medium text-gray-900">
                        {run.projectName}
                        {run.jobName && (
                          <div className="text-xs text-gray-500 font-normal">{run.jobName}</div>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-neutral capitalize">{run.platform}</span>
                      </td>
                      <td>
                        {run.buildUrl ? (
                          <a
                            href={run.buildUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:text-primary-700 flex items-center"
                          >
                            #{run.buildNumber} <ExternalLink className="w-3 h-3 ml-1" />
                          </a>
                        ) : (
                          <span className="text-gray-600">#{run.buildNumber || '-'}</span>
                        )}
                      </td>
                      <td className="text-gray-600">{run.branch || '-'}</td>
                      <td>
                        <span className="text-success-600">{run.passedTests}</span>
                        <span className="text-gray-400 mx-1">/</span>
                        <span className="text-gray-600">{run.totalTests}</span>
                      </td>
                      <td>
                        <span className={`badge ${run.passRate >= 80 ? 'badge-success' : run.passRate >= 50 ? 'badge-warning' : 'badge-danger'}`}>
                          {run.passRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-gray-600">{formatDuration(run.totalDuration)}</td>
                      <td className="text-gray-500 text-sm">
                        {run.createdAt ? format(run.createdAt, 'MMM d, HH:mm') : '-'}
                      </td>
                      <td>
                        <Link
                          href={`/runs/${run.id}`}
                          className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

            </>
          ) : (
            <div className="p-12 text-center text-gray-500">
              <History className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No test runs found</h3>
              <p className="text-gray-500">Configure your CI/CD pipeline to start sending results</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
