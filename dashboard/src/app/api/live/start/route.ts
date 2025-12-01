import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/live/start
 * Starts a live test run and returns a testRunId for streaming steps.
 * Called at the beginning of a test run before any tests execute.
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('x-api-key');

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      platform,
      jobName,
      buildNumber,
      buildUrl,
      branch,
      commit,
      totalTests,
      tests, // Array of { url, goal } for each test
    } = body;

    // Validate API key and get project
    const projectsRef = adminDb.collection('projects');
    const projectQuery = await projectsRef.where('apiKey', '==', apiKey).limit(1).get();

    if (projectQuery.empty) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    const projectDoc = projectQuery.docs[0];
    const projectId = projectDoc.id;

    // Create a test run with status 'running'
    const testRunRef = adminDb.collection('testRuns').doc();
    const testRunData = {
      projectId,
      platform: platform || 'other',
      jobName: jobName || null,
      buildNumber: buildNumber || null,
      buildUrl: buildUrl || null,
      branch: branch || null,
      commit: commit || null,
      totalTests: totalTests || tests?.length || 0,
      passedTests: 0,
      failedTests: 0,
      passRate: 0,
      totalDuration: 0,
      totalViolations: 0,
      status: 'running',
      createdAt: FieldValue.serverTimestamp(),
      completedAt: null,
    };

    await testRunRef.set(testRunData);

    // Create a liveStatus document for real-time tracking
    const liveStatusRef = adminDb.collection('liveStatus').doc(testRunRef.id);
    await liveStatusRef.set({
      testRunId: testRunRef.id,
      projectId,
      currentTestIndex: 0,
      currentTestUrl: tests?.[0]?.url || '',
      currentTestGoal: tests?.[0]?.goal || '',
      totalTests: totalTests || tests?.length || 0,
      completedTests: 0,
      isRunning: true,
      tests: tests || [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      testRunId: testRunRef.id,
      projectId,
      projectName: projectDoc.data().name,
    });
  } catch (error) {
    console.error('Error starting live run:', error);
    return NextResponse.json(
      { error: 'Failed to start live run' },
      { status: 500 }
    );
  }
}
