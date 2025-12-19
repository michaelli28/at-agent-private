import { NextRequest, NextResponse } from 'next/server';
import adminApp, { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

interface ManualTest {
  url: string;
  goal: string;
}

/**
 * POST /api/run-tests/start
 * Starts a new test run with user-specified tests from the dashboard.
 * Requires user authentication via Firebase ID token.
 */
export async function POST(request: NextRequest) {
  try {
    // Get Authorization header
    const authHeader = request.headers.get('Authorization');
    const idToken = authHeader?.replace('Bearer ', '');

    if (!idToken) {
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
    const { projectId, tests } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    if (!tests || !Array.isArray(tests) || tests.length === 0) {
      return NextResponse.json(
        { error: 'tests must be a non-empty array' },
        { status: 400 }
      );
    }

    // Validate test format
    const validTests: ManualTest[] = [];
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      if (!test.url || typeof test.url !== 'string') {
        return NextResponse.json(
          { error: `Test at index ${i} is missing a valid 'url' field` },
          { status: 400 }
        );
      }
      if (!test.goal || typeof test.goal !== 'string') {
        return NextResponse.json(
          { error: `Test at index ${i} is missing a valid 'goal' field` },
          { status: 400 }
        );
      }

      // Validate URL format
      try {
        new URL(test.url);
      } catch {
        return NextResponse.json(
          { error: `Test at index ${i} has an invalid URL: '${test.url}'` },
          { status: 400 }
        );
      }

      validTests.push({
        url: test.url.trim(),
        goal: test.goal.trim(),
      });
    }

    // Get the project to verify ownership
    const projectRef = adminDb.collection('projects').doc(projectId);
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
        { error: 'Not authorized to run tests for this project' },
        { status: 403 }
      );
    }

    // Create a new test run
    const newTestRunRef = adminDb.collection('testRuns').doc();
    const newTestRunData = {
      projectId,
      platform: 'dashboard' as const,
      jobName: `Manual Run - ${new Date().toLocaleDateString()}`,
      buildNumber: `manual-${Date.now()}`,
      buildUrl: null,
      branch: null,
      commit: null,
      totalTests: validTests.length,
      passedTests: 0,
      failedTests: 0,
      passRate: 0,
      totalDuration: 0,
      totalViolations: 0,
      status: 'running' as const,
      triggeredBy: 'dashboard' as const,
      createdAt: FieldValue.serverTimestamp(),
      completedAt: null,
    };

    await newTestRunRef.set(newTestRunData);

    // Create a manual test run job (reuses the rerunJobs collection for simplicity)
    // The worker will pick this up and execute the tests
    const manualJobRef = adminDb.collection('rerunJobs').doc();
    const manualJobData = {
      testRunId: newTestRunRef.id,
      originalTestRunId: null, // null indicates this is a manual run, not a rerun
      projectId,
      tests: validTests.map((test, index) => ({
        url: test.url,
        goal: test.goal,
        originalIndex: index,
      })),
      status: 'pending' as const,
      jobType: 'manual' as const, // Distinguish from reruns
      createdAt: FieldValue.serverTimestamp(),
      startedAt: null,
      completedAt: null,
      error: null,
    };

    await manualJobRef.set(manualJobData);

    // Create live status for real-time tracking
    const liveStatusRef = adminDb.collection('liveStatus').doc(newTestRunRef.id);
    const browserViewerUrl = process.env.BROWSER_VIEWER_URL || '';
    await liveStatusRef.set({
      testRunId: newTestRunRef.id,
      projectId,
      currentTestIndex: 0,
      currentTestUrl: validTests[0]?.url || '',
      currentTestGoal: validTests[0]?.goal || '',
      totalTests: validTests.length,
      completedTests: 0,
      passedTests: 0,
      failedTests: 0,
      isRunning: true,
      tests: validTests,
      browserViewerUrl: browserViewerUrl || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      testRunId: newTestRunRef.id,
      jobId: manualJobRef.id,
      testsCount: validTests.length,
    });
  } catch (error) {
    console.error('Error starting manual test run:', error);
    return NextResponse.json(
      { error: 'Failed to start test run' },
      { status: 500 }
    );
  }
}
