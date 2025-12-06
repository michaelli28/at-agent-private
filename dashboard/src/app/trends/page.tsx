'use client';

import { useEffect, useState } from 'react';
import { collection, query, getDocs, limit, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { TestRun, Project, TrendData } from '@/types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';

export default function TrendsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<number>(30); // days

  // Fetch user's projects first
  useEffect(() => {
    if (!user) {
      setProjects([]);
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
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch runs when projects are loaded
  useEffect(() => {
    if (!user) {
      setRuns([]);
      setLoading(false);
      return;
    }

    if (projects.length === 0) {
      setRuns([]);
      setLoading(false);
      return;
    }

    fetchRuns();
  }, [user, projects, timeRange]);

  async function fetchRuns() {
    setLoading(true);
    try {
      const projectIds = projects.map(p => p.id);
      if (projectIds.length === 0) {
        setRuns([]);
        setLoading(false);
        return;
      }

      // Firestore 'in' query supports up to 30 items
      const projectIdsToQuery = projectIds.slice(0, 30);

      // Fetch runs for user's projects (no orderBy to avoid composite index requirement)
      const startDate = subDays(new Date(), timeRange);
      const runsQuery = query(
        collection(db, 'testRuns'),
        where('projectId', 'in', projectIdsToQuery),
        limit(500)
      );
      const runsSnap = await getDocs(runsQuery);
      const runsData = runsSnap.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate(),
          completedAt: doc.data().completedAt?.toDate(),
        }))
        .filter(run => run.createdAt && run.createdAt >= startDate) as TestRun[];

      // Sort client-side by createdAt descending
      runsData.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      setRuns(runsData);
    } catch (error) {
      console.error('Error fetching trend data:', error);
    } finally {
      setLoading(false);
    }
  }

  // Filter runs by selected project
  const filteredRuns = selectedProject === 'all'
    ? runs
    : runs.filter(r => r.projectId === selectedProject);

  // Aggregate data by day for charts
  function aggregateByDay(): TrendData[] {
    const byDay = new Map<string, { passes: number; total: number; failed: number }>();

    filteredRuns.forEach(run => {
      if (!run.createdAt) return;
      const dateKey = format(run.createdAt, 'yyyy-MM-dd');
      const existing = byDay.get(dateKey) || { passes: 0, total: 0, failed: 0 };
      byDay.set(dateKey, {
        passes: existing.passes + run.passedTests,
        total: existing.total + run.totalTests,
        failed: existing.failed + run.failedTests,
      });
    });

    // Fill in missing days
    const result: TrendData[] = [];
    for (let i = timeRange - 1; i >= 0; i--) {
      const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
      const data = byDay.get(date);
      result.push({
        date: format(subDays(new Date(), i), 'MMM d'),
        passRate: data && data.total > 0 ? (data.passes / data.total) * 100 : 0,
        totalTests: data?.total || 0,
      });
    }

    return result;
  }

  const trendData = aggregateByDay();

  // Calculate summary stats
  const totalTests = filteredRuns.reduce((sum, r) => sum + r.totalTests, 0);
  const totalPassed = filteredRuns.reduce((sum, r) => sum + r.passedTests, 0);
  const overallPassRate = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;

  // Calculate trend (compare first half to second half)
  const midpoint = Math.floor(filteredRuns.length / 2);
  const firstHalf = filteredRuns.slice(midpoint);
  const secondHalf = filteredRuns.slice(0, midpoint);

  const firstHalfRate = firstHalf.length > 0
    ? (firstHalf.reduce((s, r) => s + r.passedTests, 0) / firstHalf.reduce((s, r) => s + r.totalTests, 0)) * 100
    : 0;
  const secondHalfRate = secondHalf.length > 0
    ? (secondHalf.reduce((s, r) => s + r.passedTests, 0) / secondHalf.reduce((s, r) => s + r.totalTests, 0)) * 100
    : 0;
  const trendDirection = secondHalfRate - firstHalfRate;

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
        <h1 className="text-2xl font-bold text-gray-900">Trends</h1>
        <p className="text-gray-600 mt-1">Track accessibility testing trends over time</p>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="card-body flex items-center space-x-4">
          <div>
            <label className="label">Project</label>
            <select
              className="input"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              <option value="all">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Time Range</label>
            <select
              className="input"
              value={timeRange}
              onChange={(e) => setTimeRange(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="stat-card">
          <div className="stat-value text-gray-700">{filteredRuns.length}</div>
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
            {trendDirection > 1 && <TrendingUp className="w-6 h-6 text-success-500 ml-2" />}
            {trendDirection < -1 && <TrendingDown className="w-6 h-6 text-danger-500 ml-2" />}
            {Math.abs(trendDirection) <= 1 && <Minus className="w-6 h-6 text-gray-400 ml-2" />}
          </div>
          <div className="stat-label">Pass Rate</div>
        </div>
      </div>

      {/* Pass Rate Chart */}
      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-lg font-semibold">Pass Rate Over Time</h2>
        </div>
        <div className="card-body">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                <YAxis domain={[0, 100]} stroke="#6b7280" fontSize={12} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(1)}%`, 'Pass Rate']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <Line
                  type="monotone"
                  dataKey="passRate"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ fill: '#22c55e', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tests Run Chart */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold">Tests Run Over Time</h2>
        </div>
        <div className="card-body">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <Legend />
                <Bar dataKey="totalTests" name="Tests Run" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
