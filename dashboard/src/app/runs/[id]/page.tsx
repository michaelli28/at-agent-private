'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { doc, getDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { TestRun, TestResult, Project, LiveStep } from '@/types';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Loader2,
  Radio
} from 'lucide-react';
import { format } from 'date-fns';

export default function TestRunDetailPage() {
  const params = useParams();
  const runId = params.id as string;

  const [run, setRun] = useState<TestRun | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  // Live tracking state
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [liveStatus, setLiveStatus] = useState<{
    currentTestIndex: number;
    currentTestUrl: string;
    currentTestGoal: string;
    totalTests: number;
    completedTests: number;
    passedTests: number;
    failedTests: number;
    isRunning: boolean;
  } | null>(null);

  // Define fetch functions with useCallback to avoid dependency warnings
  const fetchProjectInfo = useCallback(async () => {
    try {
      const runDoc = await getDoc(doc(db, 'testRuns', runId));
      if (runDoc.exists() && runDoc.data().projectId) {
        const projectDoc = await getDoc(doc(db, 'projects', runDoc.data().projectId));
        if (projectDoc.exists()) {
          setProject({
            id: projectDoc.id,
            ...projectDoc.data(),
          } as Project);
        }
      }
    } catch (error) {
      console.error('Error fetching project info:', error);
    }
  }, [runId]);

  const fetchResults = useCallback(async () => {
    try {
      const resultsQuery = query(
        collection(db, 'testResults'),
        where('testRunId', '==', runId)
      );
      const resultsSnap = await getDocs(resultsQuery);
      const resultsData = resultsSnap.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: docSnap.data().createdAt?.toDate(),
      })) as TestResult[];
      setResults(resultsData);
    } catch (error) {
      console.error('Error fetching results:', error);
    }
  }, [runId]);

  // Subscribe to real-time updates for the test run document itself
  useEffect(() => {
    const runUnsubscribe = onSnapshot(
      doc(db, 'testRuns', runId),
      (docSnap) => {
        if (docSnap.exists()) {
          const runData = {
            id: docSnap.id,
            ...docSnap.data(),
            createdAt: docSnap.data().createdAt?.toDate(),
            completedAt: docSnap.data().completedAt?.toDate(),
          } as TestRun;
          setRun(runData);

          // If run is completed or just completed, fetch final results
          if (runData.status === 'completed') {
            fetchResults();
          }
        } else {
          // Document doesn't exist
          setRun(null);
        }
        setLoading(false);
      },
      (error) => {
        console.error('Error subscribing to test run:', error);
        setLoading(false);
      }
    );

    // Fetch project info once
    fetchProjectInfo();

    return () => {
      runUnsubscribe();
    };
  }, [runId, fetchProjectInfo, fetchResults]);

  // Subscribe to live updates when run is in 'running' status
  useEffect(() => {
    if (!run || run.status !== 'running') {
      // Clear live data when not running
      setLiveStatus(null);
      setLiveSteps([]);
      return;
    }

    // Subscribe to live status
    const liveStatusUnsubscribe = onSnapshot(
      doc(db, 'liveStatus', runId),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setLiveStatus({
            currentTestIndex: data.currentTestIndex || 0,
            currentTestUrl: data.currentTestUrl || '',
            currentTestGoal: data.currentTestGoal || '',
            totalTests: data.totalTests || 0,
            completedTests: data.completedTests || 0,
            passedTests: data.passedTests || 0,
            failedTests: data.failedTests || 0,
            isRunning: data.isRunning ?? true,
          });
        }
      },
      (error) => {
        console.error('Error subscribing to live status:', error);
      }
    );

    // Subscribe to live steps - using simpler query without orderBy to avoid index requirement
    // We'll sort client-side instead
    const liveStepsQuery = query(
      collection(db, 'liveSteps'),
      where('testRunId', '==', runId)
    );

    const liveStepsUnsubscribe = onSnapshot(liveStepsQuery, (snapshot) => {
      const steps = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: docSnap.data().createdAt?.toDate(),
      })) as LiveStep[];
      // Sort client-side by stepNumber and testIndex
      steps.sort((a, b) => {
        if (a.testIndex !== b.testIndex) return a.testIndex - b.testIndex;
        return a.stepNumber - b.stepNumber;
      });
      setLiveSteps(steps);
    }, (error) => {
      console.error('Error subscribing to live steps:', error);
    });

    return () => {
      liveStatusUnsubscribe();
      liveStepsUnsubscribe();
    };
  }, [run?.status, runId]);

  function toggleExpanded(resultId: string) {
    const newExpanded = new Set(expandedResults);
    if (newExpanded.has(resultId)) {
      newExpanded.delete(resultId);
    } else {
      newExpanded.add(resultId);
    }
    setExpandedResults(newExpanded);
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  function getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return 'bg-danger-100 border-danger-500 text-danger-700';
      case 'serious': return 'bg-warning-100 border-warning-500 text-warning-600';
      case 'moderate': return 'bg-blue-100 border-blue-500 text-blue-700';
      default: return 'bg-gray-100 border-gray-400 text-gray-600';
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Test Run Not Found</h2>
        <p className="text-gray-600 mb-4">The test run you're looking for doesn't exist.</p>
        <Link href="/runs" className="btn btn-primary">
          Back to Test Runs
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link href="/runs" className="text-gray-500 hover:text-gray-700 flex items-center mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Test Runs
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {project?.name || 'Unknown Project'} - Build #{run.buildNumber || '-'}
            </h1>
            <p className="text-gray-600 mt-1 flex items-center space-x-4">
              <span className="badge badge-neutral capitalize">{run.platform}</span>
              {run.branch && <span>Branch: {run.branch}</span>}
              {run.commit && <span className="font-mono text-sm">{run.commit.substring(0, 7)}</span>}
              {run.buildUrl && (
                <a
                  href={run.buildUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:text-primary-700 flex items-center"
                >
                  View Build <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Stats - Use live data when running, otherwise use final run data */}
      {(() => {
        const isLive = run.status === 'running' && liveStatus;
        const totalTests = isLive ? liveStatus.totalTests : run.totalTests;
        const passedTests = isLive ? liveStatus.passedTests : run.passedTests;
        const failedTests = isLive ? liveStatus.failedTests : run.failedTests;
        const completedTests = isLive ? liveStatus.completedTests : run.totalTests;
        const passRate = completedTests > 0 ? (passedTests / completedTests) * 100 : 0;

        return (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
            <div className={`stat-card ${isLive ? 'ring-2 ring-primary-300' : ''}`}>
              <div className="stat-value text-gray-700">
                {isLive ? `${completedTests}/${totalTests}` : totalTests}
              </div>
              <div className="stat-label">{isLive ? 'Completed' : 'Total Tests'}</div>
            </div>
            <div className={`stat-card ${isLive ? 'ring-2 ring-primary-300' : ''}`}>
              <div className="stat-value text-success-600">{passedTests}</div>
              <div className="stat-label">Passed</div>
            </div>
            <div className={`stat-card ${isLive ? 'ring-2 ring-primary-300' : ''}`}>
              <div className="stat-value text-danger-600">{failedTests}</div>
              <div className="stat-label">Failed</div>
            </div>
            <div className={`stat-card ${isLive ? 'ring-2 ring-primary-300' : ''}`}>
              <div className={`stat-value ${passRate >= 80 ? 'text-success-600' : passRate >= 50 ? 'text-warning-500' : 'text-danger-600'}`}>
                {completedTests > 0 ? passRate.toFixed(1) : '-'}%
              </div>
              <div className="stat-label">Pass Rate</div>
            </div>
            <div className="stat-card">
              <div className="stat-value text-danger-600">{run.totalViolations}</div>
              <div className="stat-label">Violations</div>
            </div>
            <div className="stat-card">
              <div className="stat-value text-gray-700">{formatDuration(run.totalDuration)}</div>
              <div className="stat-label">Duration</div>
            </div>
          </div>
        );
      })()}

      {/* Progress Bar */}
      <div className="card mb-8">
        <div className="card-body">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Test Progress</span>
            <span className="text-sm text-gray-500">
              {run.passedTests} of {run.totalTests} passed
            </span>
          </div>
          <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-success-500 transition-all duration-300"
              style={{ width: `${run.passRate}%` }}
            />
          </div>
        </div>
      </div>

      {/* Live Status Panel - Only shown when run is in progress */}
      {run.status === 'running' && liveStatus && (
        <div className="card mb-8 border-2 border-primary-500 bg-primary-50">
          <div className="card-header bg-primary-100 border-b border-primary-200">
            <div className="flex items-center space-x-2">
              <Radio className="w-5 h-5 text-primary-600 animate-pulse" />
              <h2 className="text-lg font-semibold text-primary-800">Live Test Execution</h2>
              <span className="badge bg-primary-600 text-white">
                Test {liveStatus.currentTestIndex + 1} of {liveStatus.totalTests}
              </span>
            </div>
          </div>
          <div className="card-body">
            {/* Current Test Info */}
            <div className="mb-4 p-3 bg-white rounded-lg border border-primary-200">
              <div className="text-sm text-gray-500 mb-1">Currently Testing:</div>
              <div className="font-medium text-gray-900">{liveStatus.currentTestGoal}</div>
              <div className="text-sm text-gray-500 mt-1">{liveStatus.currentTestUrl}</div>
            </div>

            {/* Live Steps for Current Test */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              <div className="text-sm font-medium text-gray-700 mb-2 flex items-center">
                <Loader2 className="w-4 h-4 mr-2 animate-spin text-primary-600" />
                Agent Steps ({liveSteps.filter(s => s.testIndex === liveStatus.currentTestIndex).length})
              </div>
              {liveSteps
                .filter(s => s.testIndex === liveStatus.currentTestIndex)
                .map((step) => (
                  <div
                    key={step.id}
                    className="flex items-start space-x-3 p-3 bg-white rounded-lg border border-gray-200 animate-fadeIn"
                  >
                    <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-medium">
                      {step.stepNumber}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{step.action}</div>
                      {step.observation && (
                        <div className="text-sm text-gray-500 mt-1">{step.observation}</div>
                      )}
                      {step.thought && (
                        <div className="text-xs text-gray-400 mt-1 italic">{step.thought}</div>
                      )}
                    </div>
                  </div>
                ))}
              {liveSteps.filter(s => s.testIndex === liveStatus.currentTestIndex).length === 0 && (
                <div className="text-center py-4 text-gray-500">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                  Waiting for agent to start...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Test Results */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold">Test Results</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {results.map((result) => (
            <div key={result.id} className="p-4">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleExpanded(result.id)}
              >
                <div className="flex items-center space-x-4">
                  {result.success ? (
                    <CheckCircle className="w-6 h-6 text-success-500" />
                  ) : (
                    <XCircle className="w-6 h-6 text-danger-500" />
                  )}
                  <div>
                    <div className="font-medium text-gray-900">{result.goal}</div>
                    <div className="text-sm text-gray-500">{result.url}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-gray-500">{result.stepCount} steps</span>
                  <span className="text-sm text-gray-500">{formatDuration(result.duration)}</span>
                  {result.violations.length > 0 && (
                    <span className="badge badge-danger">{result.violations.length} violations</span>
                  )}
                  {expandedResults.has(result.id) ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </div>

              {expandedResults.has(result.id) && (
                <div className="mt-4 ml-10 space-y-4">
                  {/* Reason/Error */}
                  {result.reason && (
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm font-medium text-gray-700 mb-1">Result</div>
                      <div className="text-sm text-gray-600">{result.reason}</div>
                    </div>
                  )}
                  {result.error && (
                    <div className="p-3 bg-danger-50 rounded-lg border border-danger-200">
                      <div className="text-sm font-medium text-danger-700 mb-1">Error</div>
                      <div className="text-sm text-danger-600">{result.error}</div>
                    </div>
                  )}

                  {/* Steps */}
                  {result.steps.length > 0 && (
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">Agent Steps</div>
                      <div className="space-y-2">
                        {result.steps.map((step, idx) => (
                          <div key={idx} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                            <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-medium">
                              {step.stepNumber}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900">{step.action}</div>
                              {step.observation && (
                                <div className="text-sm text-gray-500 mt-1">{step.observation}</div>
                              )}
                              {step.thought && (
                                <div className="text-xs text-gray-400 mt-1 italic">{step.thought}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Violations */}
                  {result.violations.length > 0 && (
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">
                        Accessibility Violations ({result.violations.length})
                      </div>
                      <div className="space-y-2">
                        {result.violations.map((violation, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border-l-4 ${getSeverityColor(violation.severity)}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium">{violation.type}</span>
                              <span className="text-xs uppercase font-medium">{violation.severity}</span>
                            </div>
                            <div className="text-sm">{violation.message}</div>
                            {violation.element && (
                              <code className="block mt-2 text-xs bg-white bg-opacity-50 p-2 rounded overflow-x-auto">
                                {violation.element}
                              </code>
                            )}
                            {violation.wcagCriteria && (
                              <div className="text-xs mt-1">WCAG: {violation.wcagCriteria}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {results.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              No test results found for this run.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
