import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/live/test-complete
 * Called when a single test completes (pass or fail).
 * Updates the live status with pass/fail counts in real-time.
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
      testRunId,
      testIndex,
      success,
      url,
      goal,
    } = body;

    if (!testRunId || testIndex === undefined || success === undefined) {
      return NextResponse.json(
        { error: 'testRunId, testIndex, and success are required' },
        { status: 400 }
      );
    }

    // Verify the test run exists and API key matches
    const testRunRef = adminDb.collection('testRuns').doc(testRunId);
    const testRunDoc = await testRunRef.get();

    if (!testRunDoc.exists) {
      return NextResponse.json(
        { error: 'Test run not found' },
        { status: 404 }
      );
    }

    const testRunData = testRunDoc.data()!;

    // Verify API key matches the project
    const projectRef = adminDb.collection('projects').doc(testRunData.projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists || projectDoc.data()?.apiKey !== apiKey) {
      return NextResponse.json(
        { error: 'Invalid API key for this test run' },
        { status: 401 }
      );
    }

    // Update the live status with incremented counts
    const liveStatusRef = adminDb.collection('liveStatus').doc(testRunId);

    // Use increment to atomically update counts
    const updateData: Record<string, any> = {
      completedTests: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (success) {
      updateData.passedTests = FieldValue.increment(1);
    } else {
      updateData.failedTests = FieldValue.increment(1);
    }

    await liveStatusRef.update(updateData);

    return NextResponse.json({
      success: true,
      testIndex,
      testSuccess: success,
    });
  } catch (error) {
    console.error('Error recording test completion:', error);
    return NextResponse.json(
      { error: 'Failed to record test completion' },
      { status: 500 }
    );
  }
}
