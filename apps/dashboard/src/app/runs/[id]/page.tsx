'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  Radio,
  RefreshCw,
  Square,
  CheckSquare,
  Download,
  StopCircle,
  Ban
} from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { format } from 'date-fns';
import RerunModal from '@/components/RerunModal';

export default function TestRunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.id as string;

  const [run, setRun] = useState<TestRun | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  // Rerun state
  const [selectedTests, setSelectedTests] = useState<Set<number>>(new Set());
  const [isRerunModalOpen, setIsRerunModalOpen] = useState(false);

  // Cancel state
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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
    browserViewerUrl?: string;
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
  }, [runId, fetchProjectInfo]);

  // Subscribe to test results in real-time (shows completed tests as they finish)
  useEffect(() => {
    const resultsQuery = query(
      collection(db, 'testResults'),
      where('testRunId', '==', runId)
    );

    const resultsUnsubscribe = onSnapshot(resultsQuery, (snapshot) => {
      const resultsData = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: docSnap.data().createdAt?.toDate(),
      })) as TestResult[];
      // Sort by createdAt to maintain order
      resultsData.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      setResults(resultsData);
    }, (error) => {
      console.error('Error subscribing to test results:', error);
    });

    return () => {
      resultsUnsubscribe();
    };
  }, [runId]);

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
            browserViewerUrl: data.browserViewerUrl || undefined,
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

  // Rerun functionality
  function toggleTestSelection(index: number) {
    const newSelected = new Set(selectedTests);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedTests(newSelected);
  }

  function selectAllTests() {
    if (selectedTests.size === results.length) {
      setSelectedTests(new Set());
    } else {
      setSelectedTests(new Set(results.map((_, idx) => idx)));
    }
  }

  function selectFailedTests() {
    const failedIndices = results
      .map((result, idx) => ({ result, idx }))
      .filter(({ result }) => !result.success)
      .map(({ idx }) => idx);
    setSelectedTests(new Set(failedIndices));
  }

  function handleRerunStarted(newTestRunId: string) {
    // Navigate to the new test run after a short delay
    setTimeout(() => {
      router.push(`/runs/${newTestRunId}`);
    }, 1500);
  }

  function downloadTestSuite() {
    // Create a test suite JSON from the results
    const testSuite = results.map(result => ({
      url: result.url,
      goal: result.goal,
    }));

    // Create blob and download
    const blob = new Blob([JSON.stringify(testSuite, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-suite-${project?.name?.replace(/\s+/g, '-').toLowerCase() || 'unknown'}-${runId.substring(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCancelRun() {
    if (isCancelling) return;

    const confirmed = window.confirm(
      'Are you sure you want to cancel this test run? This action cannot be undone.'
    );

    if (!confirmed) return;

    setIsCancelling(true);
    setCancelError(null);

    try {
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        setCancelError('You must be logged in to cancel a test run');
        return;
      }

      const idToken = await user.getIdToken();

      const response = await fetch(`/api/runs/${runId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel test run');
      }

      // The UI will update automatically via the real-time subscription
    } catch (error: any) {
      console.error('Error cancelling run:', error);
      setCancelError(error.message || 'Failed to cancel test run');
    } finally {
      setIsCancelling(false);
    }
  }

  const selectedTestsData = Array.from(selectedTests).map(idx => ({
    index: idx,
    url: results[idx]?.url || '',
    goal: results[idx]?.goal || '',
    success: results[idx]?.success || false,
  }));

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
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              {project?.name || 'Unknown Project'} - Build #{run.buildNumber || '-'}
              {run.status === 'cancelled' && (
                <span className="badge bg-gray-100 text-gray-700 text-sm font-normal">
                  <Ban className="w-3 h-3 mr-1" />
                  Cancelled
                </span>
              )}
            </h1>
            <p className="text-gray-600 mt-1 flex items-center flex-wrap gap-2">
              <span className={`badge ${run.platform === 'dashboard' ? 'bg-purple-100 text-purple-700' : 'badge-neutral'} capitalize`}>
                {run.platform === 'dashboard' ? 'Dashboard Rerun' : run.platform}
              </span>
              {run.rerunFromId && (
                <Link
                  href={`/runs/${run.rerunFromId}`}
                  className="text-primary-600 hover:text-primary-700 flex items-center text-sm"
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  View Original Run
                </Link>
              )}
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
          {/* Cancel button - only show for running tests */}
          {(run.status === 'running' || run.status === 'pending') && (
            <div className="flex flex-col items-end">
              <button
                onClick={handleCancelRun}
                disabled={isCancelling}
                className="btn bg-danger-50 text-danger-700 border border-danger-300 hover:bg-danger-100 flex items-center space-x-2"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Cancelling...</span>
                  </>
                ) : (
                  <>
                    <StopCircle className="w-4 h-4" />
                    <span>Cancel Run</span>
                  </>
                )}
              </button>
              {cancelError && (
                <p className="text-danger-600 text-sm mt-1">{cancelError}</p>
              )}
            </div>
          )}
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

            {/* Browser Viewer - noVNC iframe */}
            {liveStatus.browserViewerUrl && (
              <div className="mb-4">
                <div className="text-sm font-medium text-gray-700 mb-2 flex items-center">
                  <ExternalLink className="w-4 h-4 mr-2 text-primary-600" />
                  Live Browser Preview
                  <a
                    href={liveStatus.browserViewerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-xs text-primary-600 hover:text-primary-700"
                  >
                    Open in new tab
                  </a>
                </div>
                <div className="rounded-lg overflow-hidden border border-primary-200 bg-black">
                  <iframe
                    src={liveStatus.browserViewerUrl}
                    className="w-full"
                    style={{ height: '400px' }}
                    title="Live Browser Preview"
                    allow="autoplay"
                  />
                </div>
              </div>
            )}

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
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-semibold">Test Results</h2>
          {results.length > 0 && (
            <div className="flex items-center space-x-2">
              {/* Download Test Suite Button */}
              <button
                onClick={downloadTestSuite}
                className="btn btn-secondary btn-sm flex items-center space-x-1"
                title="Download test suite as JSON"
              >
                <Download className="w-4 h-4" />
                <span>Download Suite</span>
              </button>
              {run.status === 'completed' && (
                <>
                  <button
                    onClick={selectAllTests}
                    className="btn btn-sm border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center space-x-1"
                  >
                    {selectedTests.size === results.length ? (
                      <>
                        <Square className="w-4 h-4" />
                        <span>Deselect All</span>
                      </>
                    ) : (
                      <>
                        <CheckSquare className="w-4 h-4" />
                        <span>Select All</span>
                      </>
                    )}
                  </button>
                  {results.some(r => !r.success) && (
                    <button
                      onClick={selectFailedTests}
                      className="btn btn-sm border border-danger-300 bg-danger-50 text-danger-700 hover:bg-danger-100 flex items-center space-x-1"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Select Failed</span>
                    </button>
                  )}
                  {selectedTests.size > 0 && (
                    <button
                      onClick={() => setIsRerunModalOpen(true)}
                      className="btn btn-primary btn-sm flex items-center space-x-1"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Rerun ({selectedTests.size})</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="divide-y divide-gray-200">
          {results.map((result, resultIndex) => (
            <div key={result.id} className="p-4">
              <div className="flex items-center justify-between">
                {/* Checkbox for selection */}
                {run.status === 'completed' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTestSelection(resultIndex);
                    }}
                    className="mr-3 flex-shrink-0"
                  >
                    {selectedTests.has(resultIndex) ? (
                      <CheckSquare className="w-5 h-5 text-primary-600" />
                    ) : (
                      <Square className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                    )}
                  </button>
                )}
                <div
                  className="flex items-center justify-between flex-1 cursor-pointer"
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
                    {expandedResults.has(result.id) ? (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
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

                </div>
              )}
            </div>
          ))}

          {results.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              {run.status === 'running' ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <span>Waiting for test results...</span>
                </div>
              ) : (
                'No test results found for this run.'
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rerun Modal */}
      <RerunModal
        isOpen={isRerunModalOpen}
        onClose={() => {
          setIsRerunModalOpen(false);
          setSelectedTests(new Set());
        }}
        selectedTests={selectedTestsData}
        originalTestRunId={runId}
        onRerunStarted={handleRerunStarted}
      />
    </div>
  );
}
