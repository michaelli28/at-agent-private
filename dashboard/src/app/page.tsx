'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { TestRun, Project } from '@/types';
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ArrowRight,
  Activity,
  Layers,
  BarChart3
} from 'lucide-react';
import { format } from 'date-fns';

interface DashboardData {
  totalProjects: number;
  totalTestRuns: number;
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  totalViolations: number;
  recentRuns: (TestRun & { projectName?: string })[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        // Fetch projects
        const projectsSnap = await getDocs(collection(db, 'projects'));
        const projects = projectsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Project[];

        // Fetch recent test runs
        const runsQuery = query(
          collection(db, 'testRuns'),
          orderBy('createdAt', 'desc'),
          limit(10)
        );
        const runsSnap = await getDocs(runsQuery);
        const runs = runsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate(),
          completedAt: doc.data().completedAt?.toDate(),
        })) as TestRun[];

        // Add project names to runs
        const runsWithProjects = runs.map(run => ({
          ...run,
          projectName: projects.find(p => p.id === run.projectId)?.name || 'Unknown Project'
        }));

        // Calculate totals
        let totalTests = 0;
        let totalPassed = 0;
        let totalFailed = 0;
        let totalViolations = 0;

        // Fetch all runs for totals
        const allRunsSnap = await getDocs(collection(db, 'testRuns'));
        allRunsSnap.docs.forEach(doc => {
          const run = doc.data();
          totalTests += run.totalTests || 0;
          totalPassed += run.passedTests || 0;
          totalFailed += run.failedTests || 0;
          totalViolations += run.totalViolations || 0;
        });

        setData({
          totalProjects: projects.length,
          totalTestRuns: allRunsSnap.size,
          totalTests,
          totalPassed,
          totalFailed,
          totalViolations,
          recentRuns: runsWithProjects,
        });
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent"></div>
      </div>
    );
  }

  const overallPassRate = data && data.totalTests > 0
    ? ((data.totalPassed / data.totalTests) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="animate-fadeIn">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of accessibility testing across all projects</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center">
              <Layers className="w-5 h-5 text-primary-500" />
            </div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Projects</span>
          </div>
          <div className="text-3xl font-bold text-gray-900">{data?.totalProjects || 0}</div>
          <p className="text-sm text-gray-500 mt-1">Active projects</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-gray-500" />
            </div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Runs</span>
          </div>
          <div className="text-3xl font-bold text-gray-900">{data?.totalTestRuns || 0}</div>
          <p className="text-sm text-gray-500 mt-1">Total test runs</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-primary-500" />
            </div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Pass Rate</span>
          </div>
          <div className="text-3xl font-bold text-primary-600">{overallPassRate}%</div>
          <p className="text-sm text-gray-500 mt-1">
            {data?.totalPassed || 0} of {data?.totalTests || 0} tests passed
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-danger-50 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-danger-500" />
            </div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Violations</span>
          </div>
          <div className="text-3xl font-bold text-danger-600">{data?.totalViolations || 0}</div>
          <p className="text-sm text-gray-500 mt-1">Accessibility issues found</p>
        </div>
      </div>

      {/* Recent Test Runs */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Recent Test Runs</h2>
          <Link
            href="/runs"
            className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center gap-1 transition-colors"
          >
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          {data?.recentRuns && data.recentRuns.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Platform</th>
                  <th>Build</th>
                  <th>Tests</th>
                  <th>Pass Rate</th>
                  <th>Violations</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="font-medium text-gray-900">{run.projectName}</td>
                    <td>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 text-xs font-medium capitalize">
                        {run.platform}
                      </span>
                    </td>
                    <td className="text-gray-500 font-mono text-xs">#{run.buildNumber || '-'}</td>
                    <td>
                      <span className="text-primary-600 font-medium">{run.passedTests}</span>
                      <span className="text-gray-300 mx-1">/</span>
                      <span className="text-gray-500">{run.totalTests}</span>
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        run.passRate >= 80
                          ? 'bg-primary-50 text-primary-700'
                          : run.passRate >= 50
                            ? 'bg-warning-50 text-warning-600'
                            : 'bg-danger-50 text-danger-700'
                      }`}>
                        {run.passRate.toFixed(1)}%
                      </span>
                    </td>
                    <td>
                      {run.totalViolations > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-danger-50 text-danger-700">
                          {run.totalViolations}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                          0
                        </span>
                      )}
                    </td>
                    <td className="text-gray-400 text-xs">
                      {run.createdAt ? format(run.createdAt, 'MMM d, HH:mm') : '-'}
                    </td>
                    <td>
                      <Link
                        href={`/runs/${run.id}`}
                        className="text-primary-600 hover:text-primary-700 text-sm font-medium transition-colors"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-12 text-center">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Activity className="w-7 h-7 text-gray-400" />
              </div>
              <h3 className="text-base font-medium text-gray-900 mb-1">No test runs yet</h3>
              <p className="text-gray-500 text-sm mb-6">Configure your CI/CD pipeline to start sending results</p>
              <Link href="/docs" className="btn btn-primary">
                View Setup Guide
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
