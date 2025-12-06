'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { doc, getDoc, collection, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { Project, TestRun } from '@/types';
import { ArrowLeft, Copy, Check, ExternalLink, TrendingUp, TrendingDown, Minus, Play } from 'lucide-react';
import { format } from 'date-fns';
import RunTestsModal from '@/components/RunTestsModal';

export default function ProjectDetailPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [showRunTestsModal, setShowRunTestsModal] = useState(false);

  // Fetch project details once and verify ownership
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    async function fetchProject() {
      try {
        const projectDoc = await getDoc(doc(db, 'projects', projectId));
        if (!projectDoc.exists()) {
          setLoading(false);
          return;
        }

        const projectData = projectDoc.data();

        // Verify user owns this project
        if (projectData.ownerId !== user!.uid) {
          setUnauthorized(true);
          setLoading(false);
          return;
        }

        setProject({
          id: projectDoc.id,
          ...projectData,
          createdAt: projectData.createdAt?.toDate(),
          updatedAt: projectData.updatedAt?.toDate(),
        } as Project);
      } catch (error) {
        console.error('Error fetching project:', error);
        setLoading(false);
      }
    }
    fetchProject();
  }, [projectId, user]);

  // Subscribe to real-time updates for runs
  useEffect(() => {
    // Query without orderBy to avoid index requirement, sort client-side
    const runsQuery = query(
      collection(db, 'testRuns'),
      where('projectId', '==', projectId),
      limit(50)
    );

    const unsubscribe = onSnapshot(runsQuery, (snapshot) => {
      const runsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate(),
        completedAt: doc.data().completedAt?.toDate(),
      })) as TestRun[];
      // Sort client-side by createdAt descending
      runsData.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      setRuns(runsData);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching runs for project:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  function copyApiKey() {
    if (project?.apiKey) {
      navigator.clipboard.writeText(project.apiKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-600 mb-4">You don't have permission to view this project.</p>
        <Link href="/projects" className="btn btn-primary">
          Back to Projects
        </Link>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Project Not Found</h2>
        <p className="text-gray-600 mb-4">The project you're looking for doesn't exist.</p>
        <Link href="/projects" className="btn btn-primary">
          Back to Projects
        </Link>
      </div>
    );
  }

  // Calculate stats
  const totalTests = runs.reduce((sum, r) => sum + r.totalTests, 0);
  const totalPassed = runs.reduce((sum, r) => sum + r.passedTests, 0);
  const overallPassRate = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;

  // Calculate trend
  const recentRuns = runs.slice(0, 5);
  const olderRuns = runs.slice(5, 10);
  const recentRate = recentRuns.length > 0
    ? (recentRuns.reduce((s, r) => s + r.passedTests, 0) / Math.max(1, recentRuns.reduce((s, r) => s + r.totalTests, 0))) * 100
    : 0;
  const olderRate = olderRuns.length > 0
    ? (olderRuns.reduce((s, r) => s + r.passedTests, 0) / Math.max(1, olderRuns.reduce((s, r) => s + r.totalTests, 0))) * 100
    : recentRate;
  const trend = recentRate - olderRate;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link href="/projects" className="text-gray-500 hover:text-gray-700 flex items-center mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Projects
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            {project.description && (
              <p className="text-gray-600 mt-1">{project.description}</p>
            )}
          </div>
          <button
            onClick={() => setShowRunTestsModal(true)}
            className="btn btn-primary flex items-center space-x-2"
          >
            <Play className="w-4 h-4" />
            <span>Run Tests</span>
          </button>
        </div>
      </div>

      {/* API Key Card */}
      <div className="card mb-8">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900 mb-1">API Key</h3>
              <code className="text-sm bg-gray-100 px-3 py-1.5 rounded font-mono">
                {project.apiKey}
              </code>
            </div>
            <button onClick={copyApiKey} className="btn btn-secondary">
              {copiedKey ? (
                <>
                  <Check className="w-4 h-4 mr-2 text-success-600" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Key
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-8">
        <div className="stat-card">
          <div className="stat-value text-gray-700">{runs.length}</div>
          <div className="stat-label">Test Runs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-gray-700">{totalTests}</div>
          <div className="stat-label">Total Tests</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-center">
            <span className={`stat-value ${overallPassRate >= 80 ? 'text-success-600' : overallPassRate >= 50 ? 'text-warning-500' : 'text-danger-600'}`}>
              {overallPassRate.toFixed(1)}%
            </span>
            {trend > 1 && <TrendingUp className="w-5 h-5 text-success-500 ml-2" />}
            {trend < -1 && <TrendingDown className="w-5 h-5 text-danger-500 ml-2" />}
            {Math.abs(trend) <= 1 && <Minus className="w-5 h-5 text-gray-400 ml-2" />}
          </div>
          <div className="stat-label">Pass Rate</div>
        </div>
      </div>

      {/* Recent Runs */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold">Recent Test Runs</h2>
        </div>
        <div className="overflow-x-auto">
          {runs.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
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
                {runs.map((run) => (
                  <tr key={run.id}>
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
          ) : (
            <div className="p-8 text-center text-gray-500">
              No test runs yet for this project.
            </div>
          )}
        </div>
      </div>

      {/* Run Tests Modal */}
      <RunTestsModal
        isOpen={showRunTestsModal}
        onClose={() => setShowRunTestsModal(false)}
        projectId={projectId}
        projectName={project.name}
        onRunStarted={(testRunId) => {
          setShowRunTestsModal(false);
          router.push(`/runs/${testRunId}`);
        }}
      />
    </div>
  );
}
