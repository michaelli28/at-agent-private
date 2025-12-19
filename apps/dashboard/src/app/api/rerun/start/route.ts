import { NextRequest, NextResponse } from 'next/server';
import adminApp, { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

/**
 * POST /api/rerun/start
 * Starts a rerun of selected tests from a completed test run.
 * Requires user authentication via Firebase ID token.
 */
export async function POST(request: NextRequest) {
  try {
    // Get Authorization header
    const authHeader = request.headers.get('Authorization');
    console.log('Auth header present:', !!authHeader);
    const idToken = authHeader?.replace('Bearer ', '');

    if (!idToken) {
      console.log('No token found in Authorization header');
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Verify the ID token
    let userId: string;
    try {
      const decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
      userId = decodedToken.uid;
    } catch (error) {
      console.error('Token verification error:', error);
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { originalTestRunId, testIndices } = body;

    if (!originalTestRunId) {
      return NextResponse.json(
        { error: 'originalTestRunId is required' },
        { status: 400 }
      );
    }

    if (!testIndices || !Array.isArray(testIndices) || testIndices.length === 0) {
      return NextResponse.json(
        { error: 'testIndices must be a non-empty array' },
        { status: 400 }
      );
    }

    // Get the original test run
    const originalRunRef = adminDb.collection('testRuns').doc(originalTestRunId);
    const originalRunDoc = await originalRunRef.get();

    if (!originalRunDoc.exists) {
      return NextResponse.json(
        { error: 'Original test run not found' },
        { status: 404 }
      );
    }

    const originalRunData = originalRunDoc.data()!;

    // Get the project to verify ownership
    const projectRef = adminDb.collection('projects').doc(originalRunData.projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const projectData = projectDoc.data()!;

    // Verify user owns the project
    if (projectData.ownerId !== userId) {
      return NextResponse.json(
        { error: 'Not authorized to rerun tests for this project' },
        { status: 403 }
      );
    }

    // Get the original test results to extract the tests to rerun
    const resultsQuery = await adminDb
      .collection('testResults')
      .where('testRunId', '==', originalTestRunId)
      .get();

    interface TestResultData {
      url: string;
      goal: string;
      createdAt?: { toDate?: () => Date };
      [key: string]: any;
    }

    const originalResults = resultsQuery.docs.map((doc, index) => ({
      index,
      id: doc.id,
      ...(doc.data() as TestResultData)
    }));

    // Sort results to maintain order (if there's an order field, use it)
    originalResults.sort((a, b) => {
      const aCreatedAt = a.createdAt?.toDate?.() || new Date(0);
      const bCreatedAt = b.createdAt?.toDate?.() || new Date(0);
      return aCreatedAt.getTime() - bCreatedAt.getTime();
    });

    // Extract the tests to rerun
    const testsToRerun = testIndices
      .filter((idx: number) => idx >= 0 && idx < originalResults.length)
      .map((idx: number) => ({
        url: originalResults[idx].url,
        goal: originalResults[idx].goal,
        originalIndex: idx
      }));

    if (testsToRerun.length === 0) {
      return NextResponse.json(
        { error: 'No valid tests found for the provided indices' },
        { status: 400 }
      );
    }

    // Create a new test run for the rerun
    const newTestRunRef = adminDb.collection('testRuns').doc();
    const newTestRunData = {
      projectId: originalRunData.projectId,
      platform: 'dashboard' as const,
      jobName: `Rerun from #${originalRunData.buildNumber || originalTestRunId.slice(0, 8)}`,
      buildNumber: `rerun-${Date.now()}`,
      buildUrl: null,
      branch: originalRunData.branch || null,
      commit: originalRunData.commit || null,
      totalTests: testsToRerun.length,
      passedTests: 0,
      failedTests: 0,
      passRate: 0,
      totalDuration: 0,
      totalViolations: 0,
      status: 'running' as const,
      triggeredBy: 'dashboard' as const,
      rerunFromId: originalTestRunId,
      rerunTestIndices: testIndices,
      createdAt: FieldValue.serverTimestamp(),
      completedAt: null,
    };

    await newTestRunRef.set(newTestRunData);

    // Create a rerun job
    const rerunJobRef = adminDb.collection('rerunJobs').doc();
    const rerunJobData = {
      testRunId: newTestRunRef.id,
      originalTestRunId,
      projectId: originalRunData.projectId,
      tests: testsToRerun,
      status: 'pending' as const,
      createdAt: FieldValue.serverTimestamp(),
      startedAt: null,
      completedAt: null,
      error: null,
    };

    await rerunJobRef.set(rerunJobData);

    // Create live status for real-time tracking
    const liveStatusRef = adminDb.collection('liveStatus').doc(newTestRunRef.id);
    const browserViewerUrl = process.env.BROWSER_VIEWER_URL || '';
    await liveStatusRef.set({
      testRunId: newTestRunRef.id,
      projectId: originalRunData.projectId,
      currentTestIndex: 0,
      currentTestUrl: testsToRerun[0]?.url || '',
      currentTestGoal: testsToRerun[0]?.goal || '',
      totalTests: testsToRerun.length,
      completedTests: 0,
      passedTests: 0,
      failedTests: 0,
      isRunning: true,
      tests: testsToRerun,
      browserViewerUrl: browserViewerUrl || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      testRunId: newTestRunRef.id,
      jobId: rerunJobRef.id,
      testsCount: testsToRerun.length,
    });
  } catch (error) {
    console.error('Error starting rerun:', error);
    return NextResponse.json(
      { error: 'Failed to start rerun' },
      { status: 500 }
    );
  }
}
